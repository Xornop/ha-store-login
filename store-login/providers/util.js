'use strict';

const crypto = require('crypto');

const b64url = (buf) => buf.toString('base64url');

function pkce() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

const randomState = () => b64url(crypto.randomBytes(24));

// Pull the login code out of an app redirect like scheme://host?code=...
function extractCode(value, scheme, expectedState) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== scheme) return null;
    const gotState = url.searchParams.get('state');
    if (expectedState && gotState && gotState !== expectedState) return null;
    return url.searchParams.get('code');
  } catch {
    return null;
  }
}

module.exports = { b64url, pkce, randomState, extractCode };
