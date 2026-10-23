# Monarch Money for AI agents

A portable copy of a local Monarch integration: a Node.js CLI plus an agent skill.
Use your **own** Monarch account. No credentials, account data, cloud access, or personal cleanup rules are included.

This is an unofficial integration using Monarch's web API. Endpoint/schema changes,
MFA challenges, or CAPTCHA can break it. It is not an official Monarch SDK or an MCP
server. Any agent that can run local shell commands can use it.

## Set up

Requires Node.js 22+ on macOS or Linux (POSIX file permissions). There are no npm dependencies.
After cloning this repository:

```bash
cd monarch-money-agent
npm test
npm run login
npm run monarch -- categories
npm run monarch -- transactions --limit 10
```

Run login yourself in a terminal. Prompts are hidden, including your email. Supply
the current code from your authenticator if you use TOTP MFA; press Enter if you
have no MFA. Passwords and MFA codes are not saved. Email/SMS MFA and automated
CAPTCHA solving are not implemented. If blocked, resolve the challenge in Monarch's
website and retry; some accounts may require integration changes.

For secret-manager use, inject `MONARCH_EMAIL`, `MONARCH_PASSWORD`, and optional
`MONARCH_MFA_CODE` into the login process environment. Do not put literal secrets
in shell history, chat, `.env` files inside the checkout, or Git.

Login stores only token and device UUID in `~/.config/monarch-money/session.json`,
mode `0600`. The newly created state directory uses `0700`. Session files are
plaintext credentials: protect your machine and backups. Login refuses storage
inside this checkout. Set `MONARCH_DATA_DIR` for a different private directory,
or `MONARCH_SESSION_FILE` for a specific session file. Use the same settings for
login and subsequent commands. New login replaces that selected local session.

For an existing compatible session, set `MONARCH_SESSION_FILE` to its private
JSON file containing `token` and `deviceUuid` (or `device_uuid`). Advanced callers
can inject `MONARCH_SESSION_TOKEN` and `MONARCH_DEVICE_UUID` together. Never share them.

## Connect your agent

For Codex, copy this repo to a **new** skill directory:

```bash
mkdir -p ~/.codex/skills
cp -R /path/to/monarch-money-agent ~/.codex/skills/monarch-money
```

Use that copy only if the destination does not already exist; preserve any existing
skill. Ask Codex to use `$monarch-money`. For another agent, point it to the repo's
`SKILL.md`, let it run Node scripts locally, and give it your desired read/write
permissions. Credentials belong on the same machine as the CLI. No hosted agent,
MCP connector, cloud bridge, schedule, or automatic access is created by this repo.

## Commands

```bash
node scripts/monarch-direct.js --help
node scripts/monarch-direct.js categories
node scripts/monarch-direct.js search "example merchant" --limit 10
node scripts/monarch-direct.js uncategorized --limit 20 --scan 200
node scripts/monarch-direct.js needs-review --limit 20 --scan 200
node scripts/monarch-direct.js transactions-page --offset 0 --limit 100
```

`uncategorized`, `needs-review`, and `get` inspect bounded recent windows. A zero
result does not prove the whole account is clean. `transactions-page` exposes
`offset`, `limit`, and `totalCount` for callers that need full pagination.
Transaction output includes account, merchant, note, and amount fields; treat stdout as private.

Writes are disabled by default. After authorizing the proposed change:

```bash
MONARCH_ALLOW_WRITES=1 node scripts/monarch-direct.js set-category TRANSACTION_ID "CATEGORY_NAME"
MONARCH_ALLOW_WRITES=1 node scripts/monarch-direct.js mark-reviewed TRANSACTION_ID
```

These commands write immediately. Do not enable the flag globally in your agent's
environment. The flag is an accident-prevention guard; the underlying token has
account access. Re-read the affected transaction/queue after every write. Category
creation and splitting also require `--apply`; see
[split instructions](references/split-transactions.md). Split plans must live in
`~/.config/monarch-money/exports/` (or `MONARCH_DATA_DIR/exports/`), mode `0600`.
Split/unsplit changes write an aggregate-only private change log under the state directory.

## Troubleshooting and validation

HTTP 401 usually requires fresh login. Resolve CAPTCHA on Monarch's website rather
than repeatedly retrying. Network calls time out after 30 seconds. GraphQL failures
may mean the web API schema changed. A transaction update may succeed before a
follow-up lookup fails; inspect the actual state before retrying.

`npm test` uses synthetic fixtures and mocked HTTP. It covers the login request,
private session persistence, reads, write denial/opt-in, response privacy, and split
validation. It does not prove live authentication for your account. Complete setup
by logging in and running the read-only `categories` command on your machine.

## Share through Git

The repository contains source and synthetic tests only. `.gitignore` excludes
common credential/export paths, but is not a secret scanner. Keep runtime state
outside the repo and review staged files before publishing. Share the repository
or its Git bundle, never your installed skill's private state directory.

The original protocol implementation was adapted from a local skill. The login
request was checked against the source of
[monarchmoney-ts 1.1.3](https://github.com/keithah/monarchmoney-ts)
installed during packaging; this project has no runtime dependency on that package.
