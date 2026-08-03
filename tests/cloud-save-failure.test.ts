import assert from "node:assert/strict";
import { test } from "node:test";
import { runConfirmedSave } from "../src/lib/cloudSaveCoordinator.ts";

const mutationCategories = [
  "allowance payment",
  "manual balance adjustment",
  "bucket transfer",
  "purchase request creation",
  "purchase request resolution",
  "goal creation and editing",
  "goal allocation and removal",
  "goal deletion and completion",
];

for (const category of mutationCategories) {
  test(`${category} rolls back after a network failure`, async () => {
    const confirmed = { revision: 4, balance: 20 };
    const optimistic = { revision: 4, balance: 25 };

    await assert.rejects(
      runConfirmedSave({
        target: optimistic,
        confirmedState: confirmed,
        write: async () => {
          throw new TypeError("fetch failed");
        },
        readConfirmed: async () => ({ revision: 5, balance: 25 }),
        stateFromResult: (result) => result,
        replace: (target, source) => Object.assign(target, structuredClone(source)),
      }),
      /fetch failed/,
    );

    assert.deepEqual(optimistic, confirmed);
  });
}

test("a successful save uses the confirmed server result", async () => {
  const optimistic = { revision: 4, balance: 25 };

  const result = await runConfirmedSave({
    target: optimistic,
    confirmedState: { revision: 4, balance: 20 },
    write: async () => {},
    readConfirmed: async () => ({ revision: 5, balance: 25 }),
    stateFromResult: (value) => value,
    replace: (target, source) => Object.assign(target, structuredClone(source)),
  });

  assert.deepEqual(result, { revision: 5, balance: 25 });
  assert.deepEqual(optimistic, result);
});
