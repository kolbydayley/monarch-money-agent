const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { login } = require('../scripts/monarch-session-login');
const { saveSession } = require('../scripts/private-state');

function run(args, extra = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monarch-synthetic-'));
  try {
    return spawnSync(process.execPath, ['--require', path.join(__dirname,'mock-http.cjs'), path.join(__dirname,'../scripts/monarch-direct.js'), ...args], {
      env: { PATH: process.env.PATH, MONARCH_DATA_DIR: temp, MONARCH_SESSION_TOKEN: 'synthetic-token', MONARCH_DEVICE_UUID: 'synthetic-device', ...extra }, encoding: 'utf8', timeout:10000,
    });
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
}

test('login sends own credentials and current MFA code, returns only token/device', async () => {
  const result = await login({email:'synthetic@example.invalid',password:'synthetic-password',code:'123456'}, async (url, options) => {
    assert.equal(url,'https://api.monarch.com/auth/login/');
    const body = JSON.parse(options.body);
    assert.equal(body.username,'synthetic@example.invalid');
    assert.equal(body.password,'synthetic-password');
    assert.equal(body.totp,'123456');
    assert.ok(options.signal);
    assert.equal(options.redirect,'error');
    return {ok:true,json:async()=>({token:'synthetic-token',email:'must-not-persist'})};
  });
  assert.equal(result.token,'synthetic-token');
  assert.match(result.deviceUuid,/^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(result).sort(),['deviceUuid','token']);
});

test('login errors do not expose upstream body; missing tokens fail', async () => {
  await assert.rejects(login({},async()=>({ok:false,status:401,json:async()=>{throw new Error('secret body read');}})),/HTTP 401/);
  await assert.rejects(login({},async()=>({ok:true,json:async()=>({})})),/no session token/);
});

test('session is private, minimal, and atomically replaced', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'monarch-session-synthetic-'));
  const oldDir=process.env.MONARCH_DATA_DIR, oldFile=process.env.MONARCH_SESSION_FILE;
  process.env.MONARCH_DATA_DIR=path.join(temp,'state');
  delete process.env.MONARCH_SESSION_FILE;
  try {
    const file=saveSession({token:'synthetic-token',deviceUuid:'synthetic-device',email:'discard'});
    assert.equal(fs.statSync(file).mode & 0o777,0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777,0o700);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)),{token:'synthetic-token',deviceUuid:'synthetic-device'});
    saveSession({token:'replacement-synthetic-token',deviceUuid:'synthetic-device'});
    assert.equal(fs.readdirSync(path.dirname(file)).length,1);
    process.env.MONARCH_SESSION_FILE=path.join(__dirname,'session-synthetic.json');
    assert.throws(()=>saveSession({token:'synthetic'}),/outside the checkout/);
  } finally {
    oldDir===undefined ? delete process.env.MONARCH_DATA_DIR : process.env.MONARCH_DATA_DIR=oldDir;
    oldFile===undefined ? delete process.env.MONARCH_SESSION_FILE : process.env.MONARCH_SESSION_FILE=oldFile;
    fs.rmSync(temp,{recursive:true,force:true});
  }
});

test('read commands work with synthetic authentication', () => {
  const result=run(['categories']);
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout)[0].name,'Groceries');
});

test('every mutation is blocked by default and explicit opt-in permits an authorized command', () => {
  for (const args of [['mark-reviewed','synthetic-id'],['set-category','synthetic-id','Groceries'],['category-create','Food','New category','--apply']]) {
    const result=run(args);
    assert.equal(result.status,1);
    assert.match(result.stderr,/Writes are disabled/);
  }
  const allowed=run(['mark-reviewed','synthetic-id'],{MONARCH_ALLOW_WRITES:'1'});
  assert.equal(allowed.status,0,allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).reviewStatus,'reviewed');
});

test('HTTP, non-JSON, and GraphQL errors suppress server response details', () => {
  for (const mode of ['error','nonjson','graphql-error']) {
    const result=run(['categories'],{MOCK_MODE:mode});
    assert.equal(result.status,1);
    assert.doesNotMatch(result.stdout+result.stderr,/DO_NOT_ECHO_ACCOUNT_DATA/);
  }
});
