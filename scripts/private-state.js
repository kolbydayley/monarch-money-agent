const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function dataDir() {
  return path.resolve(process.env.MONARCH_DATA_DIR || path.join(os.homedir(), '.config', 'monarch-money'));
}
function sessionFile() {
  return path.resolve(process.env.MONARCH_SESSION_FILE || path.join(dataDir(), 'session.json'));
}
function saveSession(session) {
  const file = sessionFile();
  // Keep private state outside this checkout, including paths that traverse symlinks.
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const parent = fs.realpathSync(path.dirname(file));
  const repo = path.resolve(__dirname, '..');
  const relative = path.relative(repo, parent);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('Session storage must be outside the checkout.');
  const temp = path.join(parent, `.session-${require('node:crypto').randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify({ token: session.token, deviceUuid: session.deviceUuid }) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return file;
}
module.exports = { dataDir, sessionFile, saveSession };
