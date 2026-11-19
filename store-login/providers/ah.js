'use strict';

// Albert Heijn: custom-scheme redirect appie://login-exit?code=...
const { extractCode } = require('./util');

const CLIENT_ID = 'appie-ios';
const AUTH_URL =
  `https://login.ah.nl/login?client_id=${CLIENT_ID}` +
  '&redirect_uri=appie://login-exit&response_type=code';
const TOKEN_URL = 'https://api.ah.nl/mobile-auth/v1/auth/token';
const HEADERS = {
  'User-Agent': 'Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)',
  'x-client-name': CLIENT_ID,
  'x-client-version': '9.28',
  'x-application': 'AHWEBSHOP',
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

module.exports = {
  key: 'ah',
  name: 'Albert Heijn',
  create() {
    return {
      authUrl: AUTH_URL,
      extract: (value) => extractCode(value, 'appie:'),
      exchange: async (code) => {
        const res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({ clientId: CLIENT_ID, code }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
    };
  },
};
