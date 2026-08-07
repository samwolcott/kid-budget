import assert from "node:assert/strict";
import test from "node:test";
import { availableBucketBalance } from "../src/lib/balances.ts";
import type { Kid } from "../src/types/index.ts";

function kid(): Kid {
  return {
    id: "kid-max",
    slug: "max",
    name: "Max",
    emoji: "M",
    allowanceAmount: 20,
    buckets: { spending: 10, saving: 20, giving: 5 },
    goals: [{ id: "goal", name: "Cards", emoji: "⚡", saved: 15, target: 25 }],
    transactions: [],
  };
}

test("Available Saving excludes money allocated to goals", () => {
  assert.equal(availableBucketBalance(kid(), "saving"), 5);
});

test("other buckets remain fully available", () => {
  const account = kid();
  assert.equal(availableBucketBalance(account, "spending"), 10);
  assert.equal(availableBucketBalance(account, "giving"), 5);
});
