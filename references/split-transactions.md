# Transaction splits

Use transaction splitting when one posted charge contains items that belong to
different categories or budget owners. Keep every split plan below
`~/.config/monarch-money/exports/` with mode `0600`.

## Split-plan shape

```json
[
  {
    "merchantName": "Example Retailer",
    "category": "Household Supplies",
    "amount": -42.17,
    "notes": "Household replenishment"
  },
  {
    "merchantName": "Example Retailer",
    "category": "Gifts",
    "amount": "remainder",
    "notes": "Birthday gift"
  }
]
```

- Use negative amounts for expenses and positive amounts for refunds or income.
- Every component must have the same sign as the parent.
- The components must reconcile exactly to the parent in integer cents.
- One component may use `"amount": "remainder"` (or `"remainder": true`) to
  absorb tax, discounts, or a final rounding cent.
- `category` accepts the same exact or unique category label accepted by
  `set-category`; `categoryId` is also accepted.
- `merchantName` and `notes` are optional. When omitted, the parent merchant is
  reused and notes stay empty.

## Workflow

```bash
chmod 600 ~/.config/monarch-money/exports/split-plan.json
node scripts/monarch-direct.js split-get <transaction-id>
node scripts/monarch-direct.js split <transaction-id> \
  --input ~/.config/monarch-money/exports/split-plan.json
node scripts/monarch-direct.js split <transaction-id> \
  --input ~/.config/monarch-money/exports/split-plan.json --apply
```

The first `split` invocation is a dry run. Applying a replacement for an
already-split transaction additionally requires `--replace-existing`.

To remove all splits, preview and then explicitly apply:

```bash
node scripts/monarch-direct.js unsplit <transaction-id>
node scripts/monarch-direct.js unsplit <transaction-id> --apply
```

Never delete split child transactions individually. Use `unsplit` so Monarch
restores the parent transaction.

Applying changes also requires explicit user authorization and `MONARCH_ALLOW_WRITES=1` for that invocation. If `MONARCH_DATA_DIR` is set, store plans in its `exports/` directory instead.
