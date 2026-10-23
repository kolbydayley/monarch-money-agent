const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CREATE_CATEGORY_MUTATION,
  GET_TRANSACTION_SPLITS_QUERY,
  UPDATE_TRANSACTION_SPLITS_MUTATION,
  exactCents,
  prepareSplitPlan,
  verifySplitSet,
} = require("../scripts/monarch-direct");

const categories = [
  {
    id: "cat-household",
    name: "Household Supplies",
    group: { name: "Household", type: "expense" },
  },
  {
    id: "cat-gifts",
    name: "Gifts",
    group: { name: "Other", type: "expense" },
  },
];

const parent = {
  id: "transaction-test",
  amount: -100,
  pending: false,
  hasSplitTransactions: false,
  merchant: { name: "Example Retailer" },
  category: { id: "cat-household", name: "Household Supplies" },
  splitTransactions: [],
};

test("prepares an exact-cent split with one remainder entry", () => {
  const plan = prepareSplitPlan(parent, [
    {
      merchant: "Example Retailer",
      category: "Household Supplies",
      amount: -60.01,
      notes: "Synthetic household item",
    },
    {
      merchant: "Example Retailer",
      category: "Gifts",
      amount: "remainder",
      notes: "Synthetic gift item",
    },
  ], categories);

  assert.equal(plan.parentCents, -10_000);
  assert.equal(plan.splitTotalCents, -10_000);
  assert.deepEqual(plan.splits.map((split) => split.amount), [-60.01, -39.99]);
  assert.deepEqual(plan.splits.map((split) => split.categoryId), [
    "cat-household",
    "cat-gifts",
  ]);
});

test("rejects totals that do not reconcile to the parent", () => {
  assert.throws(
    () => prepareSplitPlan(parent, [
      { category: "Household Supplies", amount: -60 },
      { category: "Gifts", amount: -39.99 },
    ], categories),
    (error) => error?.code === "split_total_mismatch",
  );
});

test("rejects wrong-sign, pending, and accidental replacement plans", () => {
  assert.throws(
    () => prepareSplitPlan(parent, [
      { category: "Household Supplies", amount: -110 },
      { category: "Gifts", amount: 10 },
    ], categories),
    (error) => error?.code === "split_sign_mismatch",
  );
  assert.throws(
    () => prepareSplitPlan({ ...parent, pending: true }, [
      { category: "Household Supplies", amount: -60 },
      { category: "Gifts", amount: -40 },
    ], categories),
    (error) => error?.code === "pending_transaction",
  );
  assert.throws(
    () => prepareSplitPlan({ ...parent, hasSplitTransactions: true }, [
      { category: "Household Supplies", amount: -60 },
      { category: "Gifts", amount: -40 },
    ], categories),
    (error) => error?.code === "existing_splits",
  );
});

test("allows an explicitly reviewed replacement and verifies regardless of order", () => {
  const plan = prepareSplitPlan(
    { ...parent, hasSplitTransactions: true },
    [
      { categoryId: "cat-household", merchantName: "Example Retailer", amount: -70 },
      { categoryId: "cat-gifts", merchantName: "Example Retailer", amount: -30 },
    ],
    categories,
    { replaceExisting: true },
  );
  const actual = [
    {
      amount: -30,
      category: { id: "cat-gifts" },
      merchant: { name: "Example Retailer" },
      notes: "",
    },
    {
      amount: -70,
      category: { id: "cat-household" },
      merchant: { name: "Example Retailer" },
      notes: "",
    },
  ];

  assert.deepEqual(verifySplitSet(actual, plan.splits), {
    countMatches: true,
    contentMatches: true,
  });
});

test("uses exact cents and the current split query contract", () => {
  assert.equal(exactCents("-12.34", "amount"), -1_234);
  assert.throws(
    () => exactCents("-12.345", "amount"),
    (error) => error?.code === "invalid_split_amount",
  );
  assert.match(GET_TRANSACTION_SPLITS_QUERY, /hasSplitTransactions/);
  assert.match(GET_TRANSACTION_SPLITS_QUERY, /splitTransactions/);
  assert.match(UPDATE_TRANSACTION_SPLITS_MUTATION, /UpdateTransactionSplitMutationInput/);
  assert.match(UPDATE_TRANSACTION_SPLITS_MUTATION, /fieldErrors/);
  assert.match(UPDATE_TRANSACTION_SPLITS_MUTATION, /notes/);
  assert.match(CREATE_CATEGORY_MUTATION, /CreateCategoryInput/);
  assert.match(CREATE_CATEGORY_MUTATION, /fieldErrors/);
});
