#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { dataDir } = require("./private-state");

const DEFAULT_BASE_URL = "https://api.monarch.com";
const WEB_CLIENT = "monarch-core-web-app-graphql";
const WEB_CLIENT_VERSION = "v1.0.1783";

const CATEGORIES_QUERY = `
query GetCategories {
  categories {
    id
    order
    name
    icon
    systemCategory
    isSystemCategory
    isDisabled
    group {
      id
      name
      type
      __typename
    }
    __typename
  }
}
`;

const GET_TRANSACTIONS_LIGHT_QUERY = `
query GetTransactionsLight(
  $offset: Int,
  $limit: Int,
  $filters: TransactionFilterInput,
  $orderBy: TransactionOrdering
) {
  allTransactions(filters: $filters) {
    totalCount
    results(offset: $offset, limit: $limit, orderBy: $orderBy) {
      id
      amount
      date
      pending
      needsReview
      reviewStatus
      notes
      category {
        id
        name
        systemCategory
      }
      merchant {
        name
      }
      account {
        id
        displayName
        mask
      }
    }
  }
}
`;

const UPDATE_TRANSACTION_MUTATION = `
mutation Common_UpdateTransaction($input: UpdateTransactionMutationInput!) {
  updateTransaction(input: $input) {
    transaction {
      id
    }
  }
}
`;

const CREATE_CATEGORY_MUTATION = `
mutation Web_CreateCategory($input: CreateCategoryInput!) {
  createCategory(input: $input) {
    errors {
      ...PayloadErrorFields
      __typename
    }
    category {
      id
      name
      icon
      isDisabled
      group {
        id
        name
        type
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment PayloadErrorFields on PayloadError {
  fieldErrors {
    field
    messages
    __typename
  }
  message
  code
  __typename
}
`;

const GET_TRANSACTION_SPLITS_QUERY = `
query TransactionSplitQuery($id: UUID!) {
  getTransaction(id: $id) {
    id
    amount
    pending
    hasSplitTransactions
    category {
      id
      name
      __typename
    }
    merchant {
      id
      name
      __typename
    }
    splitTransactions {
      id
      merchant {
        id
        name
        __typename
      }
      category {
        id
        name
        __typename
      }
      amount
      notes
      __typename
    }
    __typename
  }
}
`;

const UPDATE_TRANSACTION_SPLITS_MUTATION = `
mutation Common_SplitTransactionMutation($input: UpdateTransactionSplitMutationInput!) {
  updateTransactionSplit(input: $input) {
    errors {
      ...PayloadErrorFields
      __typename
    }
    transaction {
      id
      hasSplitTransactions
      splitTransactions {
        id
        merchant {
          id
          name
          __typename
        }
        category {
          id
          name
          __typename
        }
        amount
        notes
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment PayloadErrorFields on PayloadError {
  fieldErrors {
    field
    messages
    __typename
  }
  message
  code
  __typename
}
`;

function usage() {
  console.error(`Usage:
  monarch-direct.js categories [query]
  monarch-direct.js category-create <group> <name> [--icon <emoji>] [--apply]
  monarch-direct.js transactions [--limit N]
  monarch-direct.js transactions-page [--offset N] [--limit N]
  monarch-direct.js search <query> [--limit N]
  monarch-direct.js needs-review [--limit N] [--scan N]
  monarch-direct.js uncategorized [--limit N] [--scan N]
  monarch-direct.js get <transactionId> [--scan N]
  monarch-direct.js set-category <transactionId> <category>
  monarch-direct.js mark-reviewed <transactionId>
  monarch-direct.js update <transactionId> [--category <value>] [--merchant <value>] [--amount <value>] [--date <YYYY-MM-DD>] [--notes <value>] [--clear-notes] [--hide-from-reports] [--show-in-reports] [--review-status <needs_review|reviewed>]
  monarch-direct.js split-get <transactionId>
  monarch-direct.js split <transactionId> --input <private-json-path> [--apply] [--replace-existing]
  monarch-direct.js unsplit <transactionId> [--apply]
`);
}

function fail(message, details) {
  if (details !== undefined) {
    console.error(JSON.stringify({ error: message, details }, null, 2));
  } else {
    console.error(JSON.stringify({ error: message }, null, 2));
  }
  process.exit(1);
}

function parseInteger(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) fail(`Invalid ${label}: ${value}`);
  return parsed;
}

function parseNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`Invalid ${label}: ${value}`);
  return parsed;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function splitError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function exactCents(value, label) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) {
      throw splitError("invalid_split_amount", `Invalid ${label}: ${value}`);
    }
    value = Number(text);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw splitError("invalid_split_amount", `Invalid ${label}: ${value}`);
  }
  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > 1e-7) {
    throw splitError("invalid_split_amount", `${label} must use no more than two decimal places.`);
  }
  return cents;
}

function privateSplitInputPath(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw splitError("missing_split_input", "A private split-plan JSON path is required.");
  }
  const home = process.env.HOME?.trim() || os.homedir();
  const allowedRoot = path.resolve(dataDir(), "exports");
  const resolved = fs.realpathSync(path.resolve(inputPath));
  const relative = path.relative(allowedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw splitError(
      "unapproved_split_input_path",
      `Split plans must be files below ${allowedRoot}.`,
    );
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw splitError("invalid_split_input", "The split-plan path is not a file.");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw splitError("unsafe_split_input_permissions", "Split-plan files must use mode 0600.");
  }
  return resolved;
}

function readSplitPlanFile(inputPath) {
  const resolved = privateSplitInputPath(inputPath);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const splits = Array.isArray(parsed) ? parsed : parsed?.splits;
  if (!Array.isArray(splits)) {
    throw splitError("invalid_split_input", "Split-plan JSON must be an array or an object with a splits array.");
  }
  return splits;
}

function normalizedSplitText(value, fallback, label, maxLength) {
  const text = String(value ?? fallback ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  if (!text) throw splitError("invalid_split_text", `${label} cannot be empty.`);
  if (text.length > maxLength) {
    throw splitError("invalid_split_text", `${label} exceeds ${maxLength} characters.`);
  }
  return text;
}

function normalizedOptionalSplitText(value, label, maxLength) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  if (text.length > maxLength) {
    throw splitError("invalid_split_text", `${label} exceeds ${maxLength} characters.`);
  }
  return text;
}

function prepareSplitPlan(transaction, rawSplits, categories, options = {}) {
  if (!transaction?.id) throw splitError("invalid_parent_transaction", "The parent transaction is missing an id.");
  if (transaction.pending === true) {
    throw splitError("pending_transaction", "Pending transactions cannot be split safely.");
  }
  if (transaction.hasSplitTransactions && !options.replaceExisting) {
    throw splitError(
      "existing_splits",
      "This transaction already has splits. Pass --replace-existing only after reviewing the current split set.",
    );
  }
  if (!Array.isArray(rawSplits) || rawSplits.length < 2) {
    throw splitError("invalid_split_count", "A split plan must contain at least two entries.");
  }

  const parentCents = exactCents(transaction.amount, "parent amount");
  if (parentCents === 0) throw splitError("zero_parent_amount", "A zero-value transaction cannot be split.");
  const fallbackMerchant = normalizedSplitText(
    transaction?.merchant?.name,
    "",
    "Parent merchant",
    255,
  );
  const fallbackCategory = String(transaction?.category?.id || "").trim();
  let remainderIndex = -1;
  let specifiedCents = 0;

  const prepared = rawSplits.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw splitError("invalid_split_entry", `Split ${index + 1} must be an object.`);
    }
    const wantsRemainder = entry.remainder === true || entry.amount === "remainder";
    if (wantsRemainder) {
      if (remainderIndex >= 0) {
        throw splitError("multiple_remainders", "Only one split may use the remainder amount.");
      }
      remainderIndex = index;
    }
    const categorySpec = String(entry.categoryId || entry.category || fallbackCategory).trim();
    if (!categorySpec) {
      throw splitError("missing_split_category", `Split ${index + 1} is missing a category.`);
    }
    const category = resolveCategoryMatch(categories, categorySpec);
    const merchantName = normalizedSplitText(
      entry.merchantName ?? entry.merchant,
      fallbackMerchant,
      `Split ${index + 1} merchant`,
      255,
    );
    const notes = normalizedOptionalSplitText(
      entry.notes,
      `Split ${index + 1} notes`,
      2000,
    );
    const amountCents = wantsRemainder
      ? null
      : exactCents(entry.amount, `split ${index + 1} amount`);
    if (amountCents !== null) specifiedCents += amountCents;
    return {
      amountCents,
      categoryId: String(category.id),
      categoryLabel: categoryLabel(category),
      merchantName,
      notes,
    };
  });

  if (remainderIndex >= 0) {
    prepared[remainderIndex].amountCents = parentCents - specifiedCents;
  }
  for (const [index, split] of prepared.entries()) {
    if (split.amountCents === 0) {
      throw splitError("zero_split_amount", `Split ${index + 1} cannot have a zero amount.`);
    }
    if (Math.sign(split.amountCents) !== Math.sign(parentCents)) {
      throw splitError(
        "split_sign_mismatch",
        `Split ${index + 1} must use the same sign as the parent transaction.`,
      );
    }
  }
  const splitTotalCents = prepared.reduce((total, split) => total + split.amountCents, 0);
  if (splitTotalCents !== parentCents) {
    throw splitError(
      "split_total_mismatch",
      `Split total ${splitTotalCents} cents does not equal parent ${parentCents} cents.`,
    );
  }

  return {
    parentCents,
    splitTotalCents,
    splits: prepared.map((split) => ({
      merchantName: split.merchantName,
      amount: split.amountCents / 100,
      categoryId: split.categoryId,
      notes: split.notes,
    })),
    preview: prepared.map((split) => ({
      merchantName: split.merchantName,
      amount: split.amountCents / 100,
      category: { id: split.categoryId, label: split.categoryLabel },
      notes: split.notes,
    })),
  };
}

function canonicalSplit(split) {
  return JSON.stringify({
    amountCents: exactCents(split?.amount, "verified split amount"),
    categoryId: String(split?.categoryId || split?.category?.id || ""),
    merchantName: String(split?.merchantName || split?.merchant?.name || "").trim(),
    notes: String(split?.notes || ""),
  });
}

function verifySplitSet(actualSplits, expectedSplits) {
  const actual = (Array.isArray(actualSplits) ? actualSplits : []).map(canonicalSplit).sort();
  const expected = (Array.isArray(expectedSplits) ? expectedSplits : []).map(canonicalSplit).sort();
  return {
    countMatches: actual.length === expected.length,
    contentMatches:
      actual.length === expected.length
      && actual.every((value, index) => value === expected[index]),
  };
}

function sessionFileCandidates() {
  const home = process.env.HOME?.trim() || os.homedir();
  if (process.env.MONARCH_SESSION_FILE?.trim()) {
    return [process.env.MONARCH_SESSION_FILE.trim()];
  }
  return [path.join(dataDir(), "session.json")];
}

function loadSession() {
  for (const candidate of sessionFileCandidates()) {
    try {
      if (!fs.existsSync(candidate)) continue;
      return { path: candidate, value: JSON.parse(fs.readFileSync(candidate, "utf8")) };
    } catch {
      continue;
    }
  }
  return null;
}

function getAuthContext() {
  const session = loadSession();
  const sessionValue = session?.value || {};
  const token = (process.env.MONARCH_SESSION_TOKEN || sessionValue.token || "").trim();
  const deviceUuid = (
    process.env.MONARCH_DEVICE_UUID ||
    sessionValue.deviceUuid ||
    sessionValue.device_uuid ||
    ""
  ).trim();

  if (!token) fail("No Monarch session token is available.", { sessionFile: session?.path || null });
  if (!deviceUuid) fail("No Monarch device UUID is available.", { sessionFile: session?.path || null });
  return {
    baseUrl: DEFAULT_BASE_URL,
    sessionFile: session?.path || null,
    token,
    deviceUuid,
  };
}

async function graphql({ operationName, query, variables = {} }) {
  if (/^\s*mutation\b/.test(query) && process.env.MONARCH_ALLOW_WRITES !== "1") {
    fail("Writes are disabled. After explicit user authorization, set MONARCH_ALLOW_WRITES=1 for this command only.");
  }
  const auth = getAuthContext();
  const response = await fetch(`${auth.baseUrl}/graphql`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Token ${auth.token}`,
      "Client-Platform": "web",
      "Device-UUID": auth.deviceUuid,
      "Monarch-Client": WEB_CLIENT,
      "Monarch-Client-Version": WEB_CLIENT_VERSION,
    },
    body: JSON.stringify({ operationName, query, variables }),
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });

  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    fail(`Monarch returned a non-JSON response (${response.status}).`);
  }
  if (!response.ok) fail(`Monarch GraphQL request failed (${response.status}).`, { operationName });
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    fail("Monarch returned GraphQL errors. The API contract or request may need updating.", { operationName });
  }
  return payload.data;
}

function categoryLabel(category) {
  const group = category?.group?.name ? String(category.group.name).trim() : "";
  const name = category?.name ? String(category.name).trim() : "";
  return group && name ? `${group}/${name}` : name || String(category?.id || "");
}

function isUncategorizedTransaction(transaction) {
  const category = transaction?.category && typeof transaction.category === "object" ? transaction.category : null;
  const name = normalizeText(category?.name || "");
  const systemCategory = normalizeText(category?.systemCategory || category?.system_category || "");
  return !category || name === "uncategorized" || systemCategory === "uncategorized";
}

function isNeedsReviewTransaction(transaction) {
  return transaction?.needsReview === true || normalizeText(transaction?.reviewStatus || "") === "needs_review";
}

async function getCategories() {
  const data = await graphql({ operationName: "GetCategories", query: CATEGORIES_QUERY });
  return Array.isArray(data?.categories) ? data.categories : [];
}

function resolveCategoryGroup(categories, spec) {
  const normalizedSpec = normalizeText(spec);
  const groups = new Map();
  for (const category of categories) {
    const group = category?.group;
    if (!group?.id || !group?.name) continue;
    groups.set(String(group.id), group);
  }
  const matches = [...groups.values()].filter((group) => (
    String(group.id) === spec || normalizeText(group.name) === normalizedSpec
  ));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) fail(`Multiple category groups matched "${spec}".`);
  fail(`No category group matched "${spec}".`);
}

async function createCategory({ groupId, name, icon }) {
  const start = new Date();
  start.setUTCDate(1);
  const data = await graphql({
    operationName: "Web_CreateCategory",
    query: CREATE_CATEGORY_MUTATION,
    variables: {
      input: {
        group: groupId,
        name,
        icon,
        rolloverEnabled: false,
        rolloverType: "monthly",
        rolloverStartMonth: start.toISOString().slice(0, 10),
      },
    },
  });
  const payload = data?.createCategory;
  const errors = Array.isArray(payload?.errors) ? payload.errors.filter(Boolean) : [];
  if (errors.length > 0 || !payload?.category?.id) {
    const error = new Error("Monarch rejected the category creation.");
    error.details = { errors };
    throw error;
  }
  return payload.category;
}

function resolveCategoryMatch(categories, spec) {
  const normalizedSpec = normalizeText(spec);
  const exact = [];
  const fuzzy = [];
  for (const category of categories) {
    const id = String(category?.id || "");
    const name = String(category?.name || "");
    const label = categoryLabel(category);
    const normalizedName = normalizeText(name);
    const normalizedLabel = normalizeText(label);
    if (id === spec || normalizedName === normalizedSpec || normalizedLabel === normalizedSpec) {
      exact.push(category);
    } else if (normalizedSpec && (normalizedName.includes(normalizedSpec) || normalizedLabel.includes(normalizedSpec))) {
      fuzzy.push(category);
    }
  }
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) fail(`Multiple categories matched "${spec}" exactly.`, { matches: exact.map((c) => ({ id: c.id, label: categoryLabel(c) })) });
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) fail(`Multiple categories matched "${spec}" loosely.`, { matches: fuzzy.slice(0, 10).map((c) => ({ id: c.id, label: categoryLabel(c) })) });
  fail(`No category matched "${spec}".`);
}

async function searchTransactions({ search, limit }) {
  const data = await graphql({
    operationName: "GetTransactionsLight",
    query: GET_TRANSACTIONS_LIGHT_QUERY,
    variables: {
      limit,
      offset: 0,
      orderBy: "date",
      filters: { transactionVisibility: "non_hidden_transactions_only", search },
    },
  });
  const allTransactions = data?.allTransactions;
  return {
    totalCount: Number(allTransactions?.totalCount || 0),
    results: Array.isArray(allTransactions?.results) ? allTransactions.results : [],
  };
}

async function getRecentTransactions({ limit, offset = 0 }) {
  const data = await graphql({
    operationName: "GetTransactionsLight",
    query: GET_TRANSACTIONS_LIGHT_QUERY,
    variables: {
      limit,
      offset,
      orderBy: "date",
      filters: { transactionVisibility: "non_hidden_transactions_only" },
    },
  });
  const allTransactions = data?.allTransactions;
  return {
    totalCount: Number(allTransactions?.totalCount || 0),
    results: Array.isArray(allTransactions?.results) ? allTransactions.results : [],
  };
}

async function getRecentTransactionById(transactionId, scan) {
  const { results } = await getRecentTransactions({ limit: scan });
  const transaction = results.find((entry) => entry?.id === transactionId) || null;
  if (!transaction) fail(`Transaction ${transactionId} was not found in the most recent ${scan} transactions.`);
  return transaction;
}

function buildUpdateTransactionInput(id, updates) {
  const input = { id };
  if (typeof updates.merchant === "string" && updates.merchant.trim()) input.name = updates.merchant.trim();
  if (typeof updates.amount === "number" && Number.isFinite(updates.amount)) input.amount = updates.amount;
  if (typeof updates.date === "string" && updates.date.trim()) input.date = updates.date.trim();
  const categoryId = typeof updates.category === "string" ? updates.category.trim() : typeof updates.categoryId === "string" ? updates.categoryId.trim() : "";
  if (categoryId) input.category = categoryId;
  if (typeof updates.notes === "string") input.notes = updates.notes;
  if (typeof updates.hideFromReports === "boolean") input.hideFromReports = updates.hideFromReports;
  if (typeof updates.reviewStatus === "string" && updates.reviewStatus.trim()) input.reviewStatus = updates.reviewStatus.trim();
  return input;
}

async function updateTransaction(transactionId, updates) {
  const data = await graphql({
    operationName: "Common_UpdateTransaction",
    query: UPDATE_TRANSACTION_MUTATION,
    variables: { input: buildUpdateTransactionInput(transactionId, updates) },
  });
  const updatedId = data?.updateTransaction?.transaction?.id;
  if (!updatedId) fail("Monarch did not return an updated transaction id.", data);
  return updatedId;
}

async function getTransactionSplits(transactionId) {
  const data = await graphql({
    operationName: "TransactionSplitQuery",
    query: GET_TRANSACTION_SPLITS_QUERY,
    variables: { id: transactionId },
  });
  const transaction = data?.getTransaction;
  if (!transaction?.id) fail("Monarch did not return the requested transaction.");
  if (!Array.isArray(transaction.splitTransactions)) transaction.splitTransactions = [];
  return transaction;
}

async function updateTransactionSplits(transactionId, splitData) {
  const data = await graphql({
    operationName: "Common_SplitTransactionMutation",
    query: UPDATE_TRANSACTION_SPLITS_MUTATION,
    variables: {
      input: {
        transactionId,
        splitData: Array.isArray(splitData) ? splitData : [],
      },
    },
  });
  const payload = data?.updateTransactionSplit;
  const errors = Array.isArray(payload?.errors) ? payload.errors.filter(Boolean) : [];
  if (errors.length > 0) {
    const error = splitError("split_mutation_rejected", "Monarch rejected the transaction split.");
    error.details = {
      errors: errors.map((entry) => ({
        code: entry?.code || null,
        message: entry?.message || null,
        fieldErrors: Array.isArray(entry?.fieldErrors)
          ? entry.fieldErrors.map((fieldError) => ({
              field: fieldError?.field || null,
              messages: fieldError?.messages || [],
            }))
          : [],
      })),
    };
    throw error;
  }
  if (!payload?.transaction?.id) {
    throw splitError("missing_split_result", "Monarch did not return the split transaction.");
  }
  return payload.transaction;
}

function appendSplitChangeLog({ action, splitCount, failureCount }) {
  const home = process.env.HOME?.trim() || os.homedir();
  const reportsDir = path.join(dataDir(), "reports");
  const logPath = path.join(reportsDir, "change-log.md");
  fs.mkdirSync(reportsDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(reportsDir, 0o700);
  const line = [
    `- ${new Date().toISOString()}`,
    `source=monarch-direct`,
    `action=${action}`,
    `transaction_count=1`,
    `split_count=${Number(splitCount || 0)}`,
    `failure_count=${Number(failureCount || 0)}`,
    `serious_doubt_count=0`,
  ].join(" ");
  fs.appendFileSync(logPath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(logPath, 0o600);
}

function parseFlags(values) {
  const flags = {};
  const booleanFlags = new Set([
    "--apply",
    "--clear-notes",
    "--hide-from-reports",
    "--replace-existing",
    "--show-in-reports",
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const entry = values[index];
    if (!entry.startsWith("--")) fail(`Unexpected argument: ${entry}`);
    if (booleanFlags.has(entry)) {
      flags[entry.slice(2)] = true;
      continue;
    }
    const next = values[index + 1];
    if (next === undefined || next.startsWith("--")) fail(`Missing value for ${entry}`);
    flags[entry.slice(2)] = next;
    index += 1;
  }
  return flags;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(command ? 0 : 1);
  }

  if (command === "categories") {
    const query = rest.join(" ").trim();
    const categories = await getCategories();
    if (!query) {
      console.log(JSON.stringify(categories, null, 2));
      return;
    }
    const normalizedQuery = normalizeText(query);
    const matches = categories.filter((category) => {
      const name = normalizeText(category?.name || "");
      const label = normalizeText(categoryLabel(category));
      return name.includes(normalizedQuery) || label.includes(normalizedQuery) || String(category?.id || "") === query;
    });
    console.log(JSON.stringify(matches, null, 2));
    return;
  }

  if (command === "category-create") {
    const groupSpec = rest[0];
    const categoryName = rest[1];
    const flags = parseFlags(rest.slice(2));
    const unsupported = Object.keys(flags).filter((flag) => !["apply", "icon"].includes(flag));
    if (!groupSpec || !categoryName || unsupported.length > 0) {
      if (unsupported.length > 0) fail(`Unsupported category-create flag: --${unsupported[0]}`);
      usage();
      process.exit(1);
    }
    const categories = await getCategories();
    const group = resolveCategoryGroup(categories, groupSpec);
    const existing = categories.find((category) => (
      normalizeText(category?.name) === normalizeText(categoryName)
      && String(category?.group?.id || "") === String(group.id)
      && category?.isDisabled !== true
    ));
    if (existing) {
      console.log(JSON.stringify({
        mode: "no_change",
        writesPerformed: false,
        category: { id: existing.id, name: existing.name, group: group.name },
      }, null, 2));
      return;
    }
    if (!flags.apply) {
      console.log(JSON.stringify({
        mode: "dry_run",
        writesPerformed: false,
        category: { name: categoryName, group: group.name, icon: flags.icon || "❓" },
      }, null, 2));
      return;
    }
    const created = await createCategory({
      groupId: String(group.id),
      name: String(categoryName).trim(),
      icon: String(flags.icon || "❓").trim() || "❓",
    });
    const refreshed = await getCategories();
    const verified = refreshed.some((category) => (
      String(category?.id || "") === String(created.id)
      && normalizeText(category?.name) === normalizeText(categoryName)
      && String(category?.group?.id || "") === String(group.id)
      && category?.isDisabled !== true
    ));
    if (!verified) fail("Category creation completed but fresh verification did not match.");
    console.log(JSON.stringify({
      mode: "applied",
      writesPerformed: true,
      category: { id: created.id, name: created.name, group: group.name },
      verified,
    }, null, 2));
    return;
  }

  if (command === "needs-review") {
    const flags = parseFlags(rest);
    const limit = flags.limit === undefined ? 20 : parseInteger(flags.limit, "limit");
    const scan = flags.scan === undefined ? Math.max(limit, 100) : parseInteger(flags.scan, "scan");
    const { totalCount, results } = await getRecentTransactions({ limit: scan });
    const transactions = results.filter((transaction) => isNeedsReviewTransaction(transaction)).slice(0, limit);
    console.log(JSON.stringify({ scan, limit, totalCount, count: transactions.length, transactions }, null, 2));
    return;
  }

  if (command === "transactions") {
    const flags = parseFlags(rest);
    const limit = flags.limit === undefined ? 500 : parseInteger(flags.limit, "limit");
    const { totalCount, results } = await getRecentTransactions({ limit });
    console.log(JSON.stringify({ limit, totalCount, count: results.length, transactions: results }, null, 2));
    return;
  }

  if (command === "transactions-page") {
    const flags = parseFlags(rest);
    const limit = flags.limit === undefined ? 500 : parseInteger(flags.limit, "limit");
    const offset = flags.offset === undefined ? 0 : parseInteger(flags.offset, "offset");
    if (offset < 0) fail(`Invalid offset: ${offset}`);
    const { totalCount, results } = await getRecentTransactions({ limit, offset });
    console.log(JSON.stringify({ offset, limit, totalCount, count: results.length, transactions: results }, null, 2));
    return;
  }

  if (command === "uncategorized") {
    const flags = parseFlags(rest);
    const limit = flags.limit === undefined ? 20 : parseInteger(flags.limit, "limit");
    const scan = flags.scan === undefined ? Math.max(limit, 100) : parseInteger(flags.scan, "scan");
    const { totalCount, results } = await getRecentTransactions({ limit: scan });
    const transactions = results.filter((transaction) => isUncategorizedTransaction(transaction)).slice(0, limit);
    console.log(JSON.stringify({ scan, limit, totalCount, count: transactions.length, transactions }, null, 2));
    return;
  }

  if (command === "search") {
    const query = rest[0];
    if (!query) {
      usage();
      process.exit(1);
    }
    const flags = parseFlags(rest.slice(1));
    const limit = flags.limit === undefined ? 20 : parseInteger(flags.limit, "limit");
    console.log(JSON.stringify(await searchTransactions({ search: query, limit }), null, 2));
    return;
  }

  if (command === "get") {
    const transactionId = rest[0];
    const flags = parseFlags(rest.slice(1));
    const scan = flags.scan === undefined ? 200 : parseInteger(flags.scan, "scan");
    if (!transactionId) {
      usage();
      process.exit(1);
    }
    console.log(JSON.stringify({ scan, transaction: await getRecentTransactionById(transactionId, scan) }, null, 2));
    return;
  }

  if (command === "split-get") {
    const transactionId = rest[0];
    if (!transactionId || rest.length !== 1) {
      usage();
      process.exit(1);
    }
    console.log(JSON.stringify({ transaction: await getTransactionSplits(transactionId) }, null, 2));
    return;
  }

  if (command === "split") {
    const transactionId = rest[0];
    if (!transactionId) {
      usage();
      process.exit(1);
    }
    const flags = parseFlags(rest.slice(1));
    const allowedFlags = new Set(["input", "apply", "replace-existing"]);
    const unsupported = Object.keys(flags).filter((flag) => !allowedFlags.has(flag));
    if (unsupported.length > 0) fail(`Unsupported split flag: --${unsupported[0]}`);
    if (!flags.input) fail("The split command requires --input <private-json-path>.");

    const [transaction, categories] = await Promise.all([
      getTransactionSplits(transactionId),
      getCategories(),
    ]);
    const plan = prepareSplitPlan(
      transaction,
      readSplitPlanFile(String(flags.input)),
      categories,
      { replaceExisting: flags["replace-existing"] === true },
    );
    if (!flags.apply) {
      console.log(JSON.stringify({
        mode: "dry_run",
        writesPerformed: false,
        transaction: {
          id: transaction.id,
          amount: transaction.amount,
          alreadySplit: transaction.hasSplitTransactions === true,
        },
        splitCount: plan.splits.length,
        splitTotal: plan.splitTotalCents / 100,
        checks: {
          exactCentReconciliation: plan.parentCents === plan.splitTotalCents,
          pending: transaction.pending === true,
        },
        splits: plan.preview,
      }, null, 2));
      return;
    }

    try {
      await updateTransactionSplits(transactionId, plan.splits);
      const refreshed = await getTransactionSplits(transactionId);
      const verification = verifySplitSet(refreshed.splitTransactions, plan.splits);
      if (
        refreshed.hasSplitTransactions !== true
        || !verification.countMatches
        || !verification.contentMatches
      ) {
        appendSplitChangeLog({
          action: "split",
          splitCount: plan.splits.length,
          failureCount: 1,
        });
        fail("Split mutation completed but fresh verification did not match.", { verification });
      }
      appendSplitChangeLog({
        action: "split",
        splitCount: plan.splits.length,
        failureCount: 0,
      });
      console.log(JSON.stringify({
        mode: "applied",
        writesPerformed: true,
        transaction: { id: refreshed.id },
        splitCount: refreshed.splitTransactions.length,
        verification,
      }, null, 2));
      return;
    } catch (error) {
      appendSplitChangeLog({
        action: "split",
        splitCount: plan.splits.length,
        failureCount: 1,
      });
      throw error;
    }
  }

  if (command === "unsplit") {
    const transactionId = rest[0];
    if (!transactionId) {
      usage();
      process.exit(1);
    }
    const flags = parseFlags(rest.slice(1));
    const unsupported = Object.keys(flags).filter((flag) => flag !== "apply");
    if (unsupported.length > 0) fail(`Unsupported unsplit flag: --${unsupported[0]}`);
    const transaction = await getTransactionSplits(transactionId);
    const existingCount = transaction.splitTransactions.length;
    if (!flags.apply || existingCount === 0) {
      console.log(JSON.stringify({
        mode: flags.apply ? "no_change" : "dry_run",
        writesPerformed: false,
        transaction: { id: transaction.id },
        existingSplitCount: existingCount,
        wouldRemoveSplitCount: existingCount,
      }, null, 2));
      return;
    }
    try {
      await updateTransactionSplits(transactionId, []);
      const refreshed = await getTransactionSplits(transactionId);
      const verified =
        refreshed.hasSplitTransactions !== true
        && refreshed.splitTransactions.length === 0;
      appendSplitChangeLog({
        action: "unsplit",
        splitCount: existingCount,
        failureCount: verified ? 0 : 1,
      });
      if (!verified) fail("Unsplit mutation completed but fresh verification still found splits.");
      console.log(JSON.stringify({
        mode: "applied",
        writesPerformed: true,
        transaction: { id: refreshed.id },
        removedSplitCount: existingCount,
        verified,
      }, null, 2));
      return;
    } catch (error) {
      appendSplitChangeLog({
        action: "unsplit",
        splitCount: existingCount,
        failureCount: 1,
      });
      throw error;
    }
  }

  if (command === "set-category") {
    const transactionId = rest[0];
    const categorySpec = rest.slice(1).join(" ").trim();
    if (!transactionId || !categorySpec) {
      usage();
      process.exit(1);
    }
    const category = resolveCategoryMatch(await getCategories(), categorySpec);
    const updatedId = await updateTransaction(transactionId, { category: String(category.id) });
    console.log(JSON.stringify({ resolvedCategory: { id: category.id, label: categoryLabel(category) }, transaction: { id: updatedId } }, null, 2));
    return;
  }

  if (command === "mark-reviewed") {
    const transactionId = rest[0];
    if (!transactionId) {
      usage();
      process.exit(1);
    }
    const updatedId = await updateTransaction(transactionId, { reviewStatus: "reviewed" });
    // The mutation result is authoritative here. Callers must verify the queue
    // with a fresh needs-review scan; a fixed 200-row lookup can falsely report
    // failure after successfully clearing an older review flag.
    console.log(JSON.stringify({ id: updatedId, reviewStatus: "reviewed" }, null, 2));
    return;
  }

  if (command === "update") {
    const transactionId = rest[0];
    if (!transactionId) {
      usage();
      process.exit(1);
    }
    const flags = parseFlags(rest.slice(1));
    if (flags["clear-notes"] && flags.notes !== undefined) fail("Use either --notes or --clear-notes, not both.");
    if (flags["hide-from-reports"] && flags["show-in-reports"]) fail("Use either --hide-from-reports or --show-in-reports, not both.");

    const updates = {};
    if (flags.category !== undefined) updates.category = String(resolveCategoryMatch(await getCategories(), String(flags.category)).id);
    if (flags.merchant !== undefined) updates.merchant = String(flags.merchant);
    if (flags.amount !== undefined) updates.amount = parseNumber(flags.amount, "amount");
    if (flags.date !== undefined) updates.date = String(flags.date);
    if (flags.notes !== undefined) updates.notes = String(flags.notes);
    if (flags["clear-notes"]) updates.notes = "";
    if (flags["hide-from-reports"]) updates.hideFromReports = true;
    if (flags["show-in-reports"]) updates.hideFromReports = false;
    if (flags["review-status"] !== undefined) {
      const reviewStatus = String(flags["review-status"]).trim();
      if (!["needs_review", "reviewed"].includes(reviewStatus)) fail(`Invalid --review-status: ${reviewStatus}`);
      updates.reviewStatus = reviewStatus;
    }
    if (Object.keys(updates).length === 0) fail("No transaction updates specified.");

    const updatedId = await updateTransaction(transactionId, updates);
    let transaction = null;
    const searchHint = typeof updates.merchant === "string" && updates.merchant.trim() ? updates.merchant.trim() : null;
    if (searchHint) {
      const result = await searchTransactions({ search: searchHint, limit: 20 });
      transaction = result.results.find((entry) => entry?.id === updatedId) || null;
    }
    if (!transaction) transaction = await getRecentTransactionById(updatedId, 200);
    console.log(JSON.stringify(transaction, null, 2));
    return;
  }

  usage();
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    fail(message, error?.details);
  });
}

module.exports = {
  GET_TRANSACTION_SPLITS_QUERY,
  CREATE_CATEGORY_MUTATION,
  UPDATE_TRANSACTION_SPLITS_MUTATION,
  exactCents,
  prepareSplitPlan,
  verifySplitSet,
};
