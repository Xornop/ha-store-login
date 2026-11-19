'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { chromium } = require('playwright');
const providers = require('./providers');

const PORT = 8099;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 2000;
const VIEWPORT = { width: 420, height: 740 };
const KEYS = new Set([
  'Enter', 'Tab', 'Backspace', 'Delete', 'Escape',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
]);

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

const clamp = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));

// Runs in the remote page: is a text field focused?
const isEditable = () => {
  const a = document.activeElement;
  if (!a) return false;
  if (a.isContentEditable || a.tagName === 'TEXTAREA') return true;
  if (a.tagName !== 'INPUT') return false;
  const type = (a.type || 'text').toLowerCase();
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color', 'hidden'].includes(type);
};

let active = null;

async function closeActive() {
  const session = active;
  active = null;
  if (!session) return;
  clearTimeout(session.timer);
  clearInterval(session.pollTimer);
  try {
    await session.browser.close();
  } catch {
    /* ignore */
  }
}

// Common end of every login: get the tokens, send the refresh token, close the browser
async function completeLogin(session, getTokens) {
  send(session.ws, { t: 'status', key: 'code_received' });
  try {
    const tokens = await getTokens();
    if (!tokens.refresh_token) throw new Error('No refresh token received');
    send(session.ws, { t: 'done', refresh_token: tokens.refresh_token });
  } catch (err) {
    send(session.ws, { t: 'error', key: 'login_failed', detail: err.message });
  } finally {
    if (active === session) await closeActive();
  }
}

const finishLogin = (session, code) =>
  completeLogin(session, () => session.provider.exchange(code));

// Stores without an app redirect (cookie sessions) define poll(): called until it returns tokens
function startPolling(session) {
  const { provider, ws } = session;
  let busy = false;
  session.pollTimer = setInterval(async () => {
    if (busy || session.done || active !== session) return;
    busy = true;
    try {
      const tokens = await provider.poll({
        context: session.context,
        page: session.page,
        userAgent: session.userAgent,
      });
      if (tokens && !session.done) {
        session.done = true;
        completeLogin(session, async () => tokens);
      }
    } catch (err) {
      if (!session.done) {
        session.done = true;
        console.error(`${provider.name} login failed: ${err.message}`);
        send(ws, { t: 'error', key: 'login_failed', detail: err.message });
        await closeActive();
      }
    } finally {
      busy = false;
    }
  }, POLL_MS);
}

async function startSession(ws, key) {
  await closeActive();
  const provider = providers.create(key);
  send(ws, { t: 'status', key: 'starting', name: provider.name });

  // New headless mode + a normal Chrome user agent: store sites block obvious headless browsers
  const browser = await chromium.launch({
    channel: 'chromium',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  const userAgent =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    `Chrome/${browser.version()} Safari/537.36`;
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    userAgent,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
  });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);

  const session = {
    browser,
    context,
    page,
    ws,
    provider,
    userAgent,
    done: false,
    timer: null,
    pollTimer: null,
    metaKey: '',
  };
  active = session;
  session.timer = setTimeout(async () => {
    if (active !== session) return;
    send(ws, { t: 'error', key: 'timeout' });
    await closeActive();
  }, SESSION_TIMEOUT_MS);

  const onCode = (code) => {
    if (!code || session.done) return;
    session.done = true;
    finishLogin(session, code);
  };
  // Cookie-session stores (Action) have no app redirect and no extract(): they use poll()
  const extract = (value) => (provider.extract ? provider.extract(value) : null);
  const fromHeaders = (headers) => {
    if (!headers) return;
    onCode(extract(headers.location || headers.Location));
  };

  // Catch the app redirect (appie://…, jumbo://…, com.lidlplus.app://…) from every angle
  page.on('request', (req) => onCode(extract(req.url())));
  page.on('requestfailed', (req) => onCode(extract(req.url())));
  page.on('framenavigated', (frame) => onCode(extract(frame.url())));
  page.on('response', async (res) => {
    try {
      fromHeaders(await res.allHeaders());
    } catch {
      /* ignore */
    }
  });
  client.on('Network.requestWillBeSent', (p) => {
    onCode(extract(p.request && p.request.url));
    fromHeaders(p.redirectResponse && p.redirectResponse.headers);
  });
  client.on('Network.responseReceivedExtraInfo', (p) => fromHeaders(p.headers));

  client.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
    if (metadata) {
      const metaKey = `${metadata.deviceWidth}x${metadata.deviceHeight}+${metadata.offsetTop || 0}`;
      if (metaKey !== session.metaKey) {
        session.metaKey = metaKey;
        send(ws, {
          t: 'meta',
          width: metadata.deviceWidth,
          height: metadata.deviceHeight,
          top: metadata.offsetTop || 0,
        });
      }
    }
    if (ws.readyState === 1) ws.send(Buffer.from(data, 'base64'));
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });

  await client.send('Network.enable');
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 60,
    maxWidth: VIEWPORT.width * 2,
    maxHeight: VIEWPORT.height * 2,
    everyNthFrame: 1,
  });

  send(ws, { t: 'ready', width: VIEWPORT.width, height: VIEWPORT.height });
  if (provider.poll) startPolling(session);
  page
    .goto(provider.authUrl, { waitUntil: 'domcontentloaded' })
    .then((res) => {
      const status = res ? res.status() : 0;
      console.log(`${provider.name} login page HTTP ${status}`);
      if (status >= 400) send(ws, { t: 'status', key: 'http_block', status });
    })
    .catch(() => {});
}

async function handle(ws, msg) {
  if (msg.t === 'start') return startSession(ws, String(msg.provider || ''));
  if (msg.t === 'stop') return closeActive();

  if (!active || active.ws !== ws) return;
  const { page } = active;

  switch (msg.t) {
    case 'tap': {
      await page.mouse.click(clamp(msg.x, VIEWPORT.width), clamp(msg.y, VIEWPORT.height));
      await page.waitForTimeout(80);
      const editable = await page.evaluate(isEditable).catch(() => false);
      send(ws, { t: 'editable', value: !!editable });
      break;
    }
    case 'scroll':
      await page.mouse.wheel(0, Math.max(-1500, Math.min(1500, Number(msg.dy) || 0)));
      break;
    case 'text':
      await page.keyboard.type(String(msg.value || '').slice(0, 200), { delay: 10 });
      if (msg.enter) await page.keyboard.press('Enter');
      break;
    case 'key':
      if (KEYS.has(msg.key)) await page.keyboard.press(msg.key);
      break;
    case 'back':
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      break;
    case 'clear':
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      break;
    default:
      break;
  }
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/providers', (req, res) => res.json(providers.list));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  // Handle messages strictly in order so fast typing never gets shuffled
  let chain = Promise.resolve();
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    chain = chain.then(async () => {
      try {
        await handle(ws, msg);
      } catch (err) {
        send(ws, { t: 'error', text: err.message });
      }
    });
  });
  ws.on('close', () => {
    if (active && active.ws === ws) closeActive();
  });
});

process.on('unhandledRejection', (err) => console.error('Unhandled:', err && err.message));
process.on('SIGTERM', async () => {
  await closeActive();
  process.exit(0);
});

server.listen(PORT, '0.0.0.0', () => console.log(`Store Login listening on ${PORT}`));
