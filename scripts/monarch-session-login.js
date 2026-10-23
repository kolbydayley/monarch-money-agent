#!/usr/bin/env node
const { randomUUID } = require('node:crypto');
const { saveSession } = require('./private-state');

function promptHidden(label) {
  if (!process.stdin.isTTY) throw new Error('Run login in your own terminal, or supply credentials through a secret manager environment.');
  return new Promise((resolve, reject) => {
    process.stderr.write(label);
    let value = '';
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    function finish(error) {
      process.stdin.off('data', read);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stderr.write('\n');
      error ? reject(error) : resolve(value);
    }
    function read(chunk) {
      for (const char of chunk) {
        if (char === '\u0003' || char === '\u0004') return finish(new Error('Login cancelled.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    }
    process.stdin.on('data', read);
  });
}

async function login({ email, password, code }, request = fetch) {
  const deviceUuid = randomUUID();
  const body = { username: email, password, trusted_device: true, supports_mfa: true, supports_email_otp: true, supports_recaptcha: true };
  if (code) body.totp = code;
  const response = await request('https://api.monarch.com/auth/login/', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Client-Platform': 'web', 'device-uuid': deviceUuid, Origin: 'https://app.monarchmoney.com' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
  // Never echo upstream bodies; they may contain credential or account information.
  if (!response.ok) throw new Error(`Monarch login failed (HTTP ${response.status}). Check credentials/MFA; resolve any CAPTCHA in Monarch's website, then retry manually.`);
  const session = await response.json();
  if (typeof session.token !== 'string' || !session.token) throw new Error('Login returned no session token.');
  return { token: session.token, deviceUuid };
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Run npm run login in your own terminal. Hidden prompts request email, password, and an optional current authenticator code. Alternatively inject MONARCH_EMAIL, MONARCH_PASSWORD, and optional MONARCH_MFA_CODE from a secret manager.');
    return;
  }
  const email = process.env.MONARCH_EMAIL || await promptHidden('Monarch email (hidden): ');
  const password = process.env.MONARCH_PASSWORD || await promptHidden('Monarch password (hidden): ');
  const code = process.env.MONARCH_MFA_CODE ?? (process.stdin.isTTY ? await promptHidden('Current authenticator code (Enter if none): ') : '');
  if (!email.trim() || !password) throw new Error('Email and password are required.');
  const session = await login({ email: email.trim(), password, code: code.trim() });
  const file = saveSession(session);
  console.log(JSON.stringify({ ok: true, sessionFile: file }));
}
if (require.main === module) main().catch(() => {
  console.error('Login failed. Check credentials, current MFA code, connectivity, CAPTCHA, and private storage path. Credentials and server responses are suppressed. Run this command manually again after resolving the issue.');
  process.exitCode = 1;
});
module.exports = { login };
