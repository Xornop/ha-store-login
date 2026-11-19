'use strict';

const crypto = require('crypto');

// Action (Mijn Action): no OAuth redirect but a cookie session behind Cloudflare.
// Login = e-mail + password in the web page (POST /api/auth/login), which sets the
// cookies accessToken, tokensId and refreshToken (path /api/auth). There is nothing to
// intercept: poll() watches the browser until the session works, then hands over all
// cookies + the User-Agent + the site version as one JSON string (refresh_token).
// Based on HAR captures of www.action.com; keep the fallback values in sync with
// custom_components/store_receipts/providers/action/ (api.py, queries.py).
const ORIGIN = 'https://www.action.com';
const LOGIN_URL = `${ORIGIN}/nl-nl/inloggen/`;
const REQUIRED = ['accessToken', 'tokensId'];
const FALLBACK_VERSION = '1.345';
const FEATURE_FLAGS =
  '{"enhancedProductSeo":true,"productReviews":true,"productReviewsLister":true,' +
  '"productReviewsTranslations":true,"promotionWithLoyaltyCard":true,"webshopCmsThemes":true}';
const LIST_LIMIT = 14;

// The web app uses "automatic persisted queries": a request with only the hash fails with
// PersistedQueryNotFound when the server does not know it, and the full query must then be
// POSTed once. This is the exact query text of the web app (its SHA-256 is the hash it sends).
const QUERY_LIST = "query ReceiptList($limit: Int, $offset: String) {\n  receiptList(limit: $limit, offset: $offset) {\n    receipts {\n      id\n      dateTime\n      dateTimeFormat\n      store {\n        name\n        id\n      }\n      price {\n        currency\n        total\n      }\n      returningPeriod {\n        lastReturnDate\n        returnable\n      }\n    }\n    hasNext\n    offset\n  }\n}";
const HASH_LIST = crypto.createHash('sha256').update(QUERY_LIST).digest('hex');
const EXTENSIONS = {
  persistedQuery: { sha256Hash: HASH_LIST, version: 1 },
  headers: { 'Accept-Language': 'nl-NL' },
};
const VARIABLES = { limit: LIST_LIMIT };

function receiptListUrl() {
  const query = new URLSearchParams({
    operationName: 'ReceiptList',
    variables: JSON.stringify(VARIABLES),
    extensions: JSON.stringify(EXTENSIONS),
  });
  return `${ORIGIN}/api/graphql?${query.toString()}`;
}

const postBody = () =>
  JSON.stringify({
    query: QUERY_LIST,
    operationName: 'ReceiptList',
    variables: VARIABLES,
    extensions: { headers: EXTENSIONS.headers, persistedQuery: EXTENSIONS.persistedQuery },
  });

// All action.com cookies, including refreshToken (its path /api/auth hides it from url-based lookups)
const toJar = (cookies) => {
  const jar = {};
  for (const c of cookies) {
    if (!c.domain.replace(/^\./, '').endsWith('action.com')) continue;
    if (c.value && !/[\u0000-\u001f\u007f]/.test(c.name + c.value)) jar[c.name] = c.value;
  }
  return jar;
};

// Runs in the remote page (same origin, so Cloudflare sees a normal browser)
const fetchReceiptList = async ({ url, body, flags }) => {
  const meta = document.querySelector('meta[name="release-id"]');
  const version = (meta && meta.content) || '';
  const headers = {
    'apollographql-client-name': 'web',
    'x-apollo-operation-name': 'ReceiptList',
    'x-client-version': version,
    'x-feature-flags': flags,
    'cache-control': 'no-cache',
  };
  let res = await fetch(url, { credentials: 'same-origin', headers });
  let text = await res.text();
  if (/PersistedQueryNotFound/.test(text)) {
    res = await fetch('/api/graphql', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
    });
    text = await res.text();
  }
  return { status: res.status, text, version };
};

module.exports = {
  key: 'action',
  name: 'Action',
  create() {
    let lastLog = '';
    const log = (msg) => {
      if (msg === lastLog) return;
      lastLog = msg;
      console.log(`Action login: ${msg}`);
    };

    return {
      authUrl: LOGIN_URL,
      // Called every few seconds by server.js; returns {refresh_token} once logged in
      async poll({ context, page, userAgent }) {
        const jar = toJar(await context.cookies());
        if (!REQUIRED.every((name) => jar[name])) return null;
        if (!page.url().startsWith(ORIGIN)) return null;

        // Cookies alone are not proof (guests may get some): test with a real request
        const result = await page
          .evaluate(fetchReceiptList, { url: receiptListUrl(), body: postBody(), flags: FEATURE_FLAGS })
          .catch((err) => {
            log(`page fetch failed: ${err.message.slice(0, 120)}`);
            return null;
          });
        if (!result) return null;
        log(`ReceiptList HTTP ${result.status}: ${result.text.slice(0, 140).replace(/\s+/g, ' ')}`);

        let body;
        try {
          body = JSON.parse(result.text);
        } catch {
          return null; // e.g. a Cloudflare page while it is still checking
        }
        if (!body || !body.data || !body.data.receiptList) return null;

        const session = {
          v: 1,
          user_agent: userAgent,
          cookies: toJar(await context.cookies()),
          client_version: result.version || FALLBACK_VERSION,
        };
        log(`session ready (version ${session.client_version}, cookies: ${Object.keys(session.cookies).join(', ')})`);
        return { refresh_token: JSON.stringify(session) };
      },
    };
  },
};
