'use strict';

// Lidl Plus: OpenID Connect with PKCE, redirect com.lidlplus.app://callback?code=...
const { pkce, randomState, extractCode } = require('./util');

const LIDL = {
  domain: 'accounts.lidl.com',
  clientId: 'LidlPlusNativeClient',
  redirect: 'com.lidlplus.app://callback',
  scope: 'openid profile offline_access lpprofile lpapis',
  country: 'NL',
  language: 'nl-NL',
};

module.exports = {
  key: 'lidl',
  name: 'Lidl',
  create() {
    const { verifier, challenge } = pkce();
    const state = randomState();
    const params = new URLSearchParams({
      client_id: LIDL.clientId,
      response_type: 'code',
      scope: LIDL.scope,
      redirect_uri: LIDL.redirect,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      Country: LIDL.country,
      language: LIDL.language,
    });
    return {
      authUrl: `https://${LIDL.domain}/connect/authorize?${params.toString()}`,
      extract: (value) => extractCode(value, 'com.lidlplus.app:', state),
      exchange: async (code) => {
        const basic = Buffer.from(`${LIDL.clientId}:secret`).toString('base64');
        const res = await fetch(`https://${LIDL.domain}/connect/token`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: LIDL.redirect,
            code_verifier: verifier,
          }).toString(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
    };
  },
};
