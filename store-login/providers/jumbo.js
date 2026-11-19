'use strict';

// Jumbo: Auth0 with PKCE, redirect jumbo://callbacks/login?code=...
const { pkce, randomState, extractCode } = require('./util');

const JUMBO = {
  domain: 'auth.jumbo.com',
  clientId: 'JxF3wi1b7MOTd9qXutaxqd9uHt4KmG3U',
  audience: 'https://jumbo.com/web',
  redirect: 'jumbo://callbacks/login',
  scope: 'openid profile email offline_access',
  ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
};

module.exports = {
  key: 'jumbo',
  name: 'Jumbo',
  create() {
    const { verifier, challenge } = pkce();
    const state = randomState();
    const nonce = randomState();
    const params = new URLSearchParams({
      client_id: JUMBO.clientId,
      redirect_uri: JUMBO.redirect,
      audience: JUMBO.audience,
      scope: JUMBO.scope,
      response_type: 'code',
      response_mode: 'query',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      platform: 'mobile',
      verifyEmail: 'false',
      trigger_registration_flow: 'BASIC_REGISTRATION',
      prompt: 'login',
    });
    return {
      authUrl: `https://${JUMBO.domain}/authorize?${params.toString()}`,
      extract: (value) => extractCode(value, 'jumbo:', state),
      exchange: async (code) => {
        const res = await fetch(`https://${JUMBO.domain}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': JUMBO.ua },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: JUMBO.clientId,
            code,
            redirect_uri: JUMBO.redirect,
            code_verifier: verifier,
            audience: JUMBO.audience,
            scope: JUMBO.scope,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
    };
  },
};
