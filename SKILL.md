---
name: monarch-money
description: Read Monarch Money categories and transactions, inspect uncategorized and needs-review queues, and make explicitly authorized transaction or category edits through a local CLI.
---

# Monarch Money

Run scripts relative to this skill's directory. Requires Node.js 22 or newer.
Read README.md for installation, private login, troubleshooting, and command details.

- The owner must log in in their own terminal with `node scripts/monarch-session-login.js`. Never ask them to paste credentials, session tokens, or MFA codes into chat.
- State defaults to `~/.config/monarch-money/`; `MONARCH_DATA_DIR` selects a different private directory. `MONARCH_SESSION_FILE` overrides just the session path. Never copy session data into the skill/repo.
- Start with read commands: `categories`, `transactions`, `transactions-page`, `search`, `get`, `uncategorized`, `needs-review`, `split-get`. Use `node scripts/monarch-direct.js --help` for syntax.
- Transaction output contains private financial data. Summarize aggregates unless the owner requests detail. Keep raw exports, logs, and split plans outside Git and shared memory, with mode 0600.
- Uncategorized means missing/Uncategorized category. Needs review is a separate flag and may already have the correct category. Queue scans are bounded; paginate `transactions-page` before claiming a complete audit.
- Changes require the current owner's explicit authorization for their scope. There is no inherited permission to auto-categorize or clear reviews. Set `MONARCH_ALLOW_WRITES=1` for an authorized command only. This is a local guard, not a restricted API credential or security sandbox.
- `set-category`, `mark-reviewed`, and `update` write immediately with that flag. `category-create`, `split`, and `unsplit` also need `--apply`; without it they preview only.
- Verify writes with fresh reads. A successful mutation alone does not prove the intended outcome; bounded recent lookups can miss older transactions. If a write may have succeeded before an error, inspect fresh state before retrying.
- For split plans and exact-cent checks, read references/split-transactions.md. Splits reject pending transactions, mismatched signs/totals, and accidental replacement. Replacement requires `--replace-existing`.
- Never move money, pay bills, trade, cancel subscriptions, file taxes, change external account settings, or send external communications through this integration.
- On authentication errors, ask the owner to rerun login locally. Do not hunt through other apps, cloud hosts, or other people's sessions. No scheduler or automatic cleanup is included.
