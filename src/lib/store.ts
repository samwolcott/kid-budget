import type {
  AllowanceSplit,
  BucketType,
  BucketBalances,
  FamilyBankState,
  Kid,
  PurchaseRequest,
} from "../types";
import {
  createFallbackState,
  LocalStorageStateRepository,
} from "./storage";

const stateRepository = new LocalStorageStateRepository();

export type { AllowanceSplit } from "../types";

export interface AllowancePayment {
  slug: string;
  amount: number;
}

function roundCurrency(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loadState(
  fallbackKids: Record<string, Kid>,
): Promise<FamilyBankState> {
  return stateRepository.load(fallbackKids);
}

export async function saveState(
  state: FamilyBankState,
): Promise<void> {
  await stateRepository.save(state);
}

export async function resetState(): Promise<void> {
  await stateRepository.reset();
}

export async function loadAllowanceSplit(
  fallback: AllowanceSplit,
): Promise<AllowanceSplit> {
  return stateRepository.loadAllowanceSplit(fallback);
}

export async function saveAllowanceSplit(
  split: AllowanceSplit,
): Promise<void> {
  await stateRepository.saveAllowanceSplit(split);
}

export { createFallbackState };

export function setBucketBalances(
  state: FamilyBankState,
  slug: string,
  balances: BucketBalances,
): void {
  const kid = state.kids[slug];

  if (!kid) {
    throw new Error("Kid account not found.");
  }

  const bucketTypes: BucketType[] = [
    "spending",
    "saving",
    "giving",
  ];

  for (const bucket of bucketTypes) {
    if (
      !Number.isFinite(balances[bucket]) ||
      balances[bucket] < 0
    ) {
      throw new Error("Enter a balance of $0 or more for every bucket.");
    }
  }

  const nextBalances: BucketBalances = {
    spending: roundCurrency(balances.spending),
    saving: roundCurrency(balances.saving),
    giving: roundCurrency(balances.giving),
  };
  const allocatedSavings = kid.goals.reduce(
    (total, goal) => total + goal.saved,
    0,
  );

  if (nextBalances.saving < allocatedSavings) {
    throw new Error(
      `Saving must be at least $${allocatedSavings.toFixed(2)} because that money is already allocated to goals.`,
    );
  }

  const adjustments = bucketTypes.flatMap((bucket) => {
    const difference = roundCurrency(
      nextBalances[bucket] - kid.buckets[bucket],
    );

    if (difference === 0) return [];

    return [{
      id: crypto.randomUUID(),
      date: today(),
      description: `Balance set — ${bucket[0].toUpperCase()}${bucket.slice(1)}`,
      amount: difference,
      bucket,
      type: "adjustment" as const,
    }];
  });

  kid.buckets = nextBalances;
  kid.transactions.unshift(...adjustments);
}

export function payAllowance(
  state: FamilyBankState,
  payments: AllowancePayment[],
  split: AllowanceSplit,
): void {
  if (payments.length === 0) {
    throw new Error("Choose at least one child.");
  }

  const splitTotal =
    split.spending +
    split.saving +
    split.giving;

  if (
    !Number.isFinite(splitTotal) ||
    Math.abs(splitTotal - 100) > 0.001
  ) {
    throw new Error(
      "Spending, Saving, and Giving must add up to 100%.",
    );
  }

  for (const payment of payments) {
    const kid = state.kids[payment.slug];

    if (!kid) {
      continue;
    }

    if (
      !Number.isFinite(payment.amount) ||
      payment.amount <= 0
    ) {
      throw new Error(
        `Enter a valid allowance amount for ${kid.name}.`,
      );
    }

    const total = roundCurrency(payment.amount);

    const spending = roundCurrency(
      total * (split.spending / 100),
    );

    const saving = roundCurrency(
      total * (split.saving / 100),
    );

    /*
     * Giving receives the remainder so rounding never
     * causes the three amounts to differ from the total.
     */
    const giving = roundCurrency(
      total - spending - saving,
    );

    kid.buckets.spending = roundCurrency(
      kid.buckets.spending + spending,
    );

    kid.buckets.saving = roundCurrency(
      kid.buckets.saving + saving,
    );

    kid.buckets.giving = roundCurrency(
      kid.buckets.giving + giving,
    );

    kid.transactions.unshift(
      {
        id: crypto.randomUUID(),
        date: today(),
        description: "Allowance — Spending",
        amount: spending,
        bucket: "spending",
        type: "allowance",
      },
      {
        id: crypto.randomUUID(),
        date: today(),
        description: "Allowance — Saving",
        amount: saving,
        bucket: "saving",
        type: "allowance",
      },
      {
        id: crypto.randomUUID(),
        date: today(),
        description: "Allowance — Giving",
        amount: giving,
        bucket: "giving",
        type: "allowance",
      },
    );
  }
}

export function moveMoney(
  state: FamilyBankState,
  slug: string,
  from: BucketType,
  to: BucketType,
  amount: number,
): void {
  const kid = state.kids[slug];

  if (!kid) {
    throw new Error("Kid account not found.");
  }

  if (from === to) {
    throw new Error(
      "Choose two different buckets.",
    );
  }

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Enter an amount greater than $0.",
    );
  }

  const transferAmount = roundCurrency(amount);

  if (transferAmount <= 0) {
    throw new Error(
      "Enter an amount of at least $0.01.",
    );
  }

  const allocatedSavings = kid.goals.reduce(
    (sum, goal) => sum + goal.saved,
    0,
  );
  const availableBalance = from === "saving"
    ? roundCurrency(kid.buckets.saving - allocatedSavings)
    : kid.buckets[from];

  if (availableBalance < transferAmount) {
    throw new Error(
      `There isn't enough available money in ${from}.`,
    );
  }

  kid.buckets[from] = roundCurrency(
    kid.buckets[from] - transferAmount,
  );

  kid.buckets[to] = roundCurrency(
    kid.buckets[to] + transferAmount,
  );

  kid.transactions.unshift({
    id: crypto.randomUUID(),
    date: today(),
    description: `Moved ${from} → ${to}`,
    amount: transferAmount,
    bucket: to,
    type: "transfer",
  });
}

export function createPurchaseRequest(
  state: FamilyBankState,
  slug: string,
  description: string,
  amount: number,
  bucket: BucketType,
): PurchaseRequest {
  const kid = state.kids[slug];

  if (!kid) {
    throw new Error("Kid account not found.");
  }

  if (!description.trim()) {
    throw new Error(
      "Tell us what you bought.",
    );
  }

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Enter an amount greater than $0.",
    );
  }

  if (kid.buckets[bucket] < amount) {
    throw new Error(
      `There isn't enough money in ${bucket}.`,
    );
  }

  const request: PurchaseRequest = {
    id: crypto.randomUUID(),
    kidId: kid.id,
    kidName: kid.name,
    description: description.trim(),
    amount: roundCurrency(amount),
    bucket,
    status: "pending",
    requestedAt: new Date().toISOString(),
  };

  state.purchaseRequests.unshift(request);

  return request;
}

export function resolvePurchaseRequest(
  state: FamilyBankState,
  requestId: string,
  resolution: "approved" | "declined",
): void {
  const request = state.purchaseRequests.find(
    (item) => item.id === requestId,
  );

  if (!request) {
    throw new Error("Purchase request not found.");
  }

  if (request.status !== "pending") {
    throw new Error("That purchase request was already resolved.");
  }

  if (resolution === "declined") {
    request.status = "declined";
    return;
  }

  const kid = Object.values(state.kids).find(
    (item) => item.id === request.kidId,
  );

  if (!kid) {
    throw new Error("Kid account not found.");
  }

  if (kid.buckets[request.bucket] < request.amount) {
    throw new Error(
      "That bucket no longer has enough money.",
    );
  }

  kid.buckets[request.bucket] = roundCurrency(
    kid.buckets[request.bucket] - request.amount,
  );

  kid.transactions.unshift({
    id: crypto.randomUUID(),
    date: today(),
    description: request.description,
    amount: -request.amount,
    bucket: request.bucket,
    type: "purchase",
  });

  request.status = "approved";
}

export function createGoal(
  state: FamilyBankState,
  slug: string,
  name: string,
  target: number,
  emoji: string,
): void {
  const kid = state.kids[slug];

  if (!kid) {
    throw new Error("Kid account not found.");
  }

  const trimmedName = name.trim();
  const trimmedEmoji = emoji.trim();

  if (!trimmedName) {
    throw new Error("Give your goal a name.");
  }

  if (!Number.isFinite(target) || target <= 0) {
    throw new Error("Enter a target greater than $0.");
  }

  kid.goals.push({
    id: crypto.randomUUID(),
    name: trimmedName,
    emoji: trimmedEmoji || "🎯",
    saved: 0,
    target: roundCurrency(target),
  });
}

export function editGoal(
  state: FamilyBankState,
  slug: string,
  goalId: string,
  name: string,
  target: number,
  emoji: string,
): void {
  const kid = state.kids[slug];

  if (!kid) {
    throw new Error("Kid account not found.");
  }

  const goal = kid.goals.find(
    (item) => item.id === goalId,
  );

  if (!goal) {
    throw new Error("Savings goal not found.");
  }

  const trimmedName = name.trim();
  const trimmedEmoji = emoji.trim();

  if (!trimmedName) {
    throw new Error("Give your goal a name.");
  }

  if (!Number.isFinite(target) || target <= 0) {
    throw new Error("Enter a target greater than $0.");
  }

  const roundedTarget = roundCurrency(target);

  if (roundedTarget < goal.saved) {
    throw new Error(
      `Your target must be at least $${goal.saved.toFixed(2)} because that amount is already saved.`,
    );
  }

  goal.name = trimmedName;
  goal.emoji = trimmedEmoji || "🎯";
  goal.target = roundedTarget;
}

export function allocateToGoal(
  state: FamilyBankState,
  slug: string,
  goalId: string,
  amount: number,
): void {
  const kid = state.kids[slug];

  if (!kid) {
    throw new Error("Kid account not found.");
  }

  const goal = kid.goals.find(
    (item) => item.id === goalId,
  );

  if (!goal) {
    throw new Error("Savings goal not found.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter an amount greater than $0.");
  }

  const allocatedSavings = kid.goals.reduce(
    (sum, item) => sum + item.saved,
    0,
  );

  const availableSavings = roundCurrency(
    kid.buckets.saving - allocatedSavings,
  );

  const remainingForGoal = roundCurrency(
    goal.target - goal.saved,
  );

  if (remainingForGoal <= 0) {
    throw new Error("That goal is already complete.");
  }

  if (amount > availableSavings) {
    throw new Error(
      `You only have $${availableSavings.toFixed(2)} available to allocate.`,
    );
  }

  if (amount > remainingForGoal) {
    throw new Error(
      `You only need $${remainingForGoal.toFixed(2)} more to complete this goal.`,
    );
  }

  goal.saved = roundCurrency(
    goal.saved + amount,
  );

  kid.transactions.unshift({
    id: crypto.randomUUID(),
    date: today(),
    description: `Added to ${goal.name}`,
    amount: roundCurrency(amount),
    bucket: "saving",
    type: "goal",
  });
}



export function removeFromGoal(
  state: FamilyBankState,
  slug: string,
  goalId: string,
  amount: number,
): void {
  const kid = state.kids[slug];

  if (!kid) {
    throw new Error("Kid account not found.");
  }

  const goal = kid.goals.find(
    (item) => item.id === goalId,
  );

  if (!goal) {
    throw new Error("Savings goal not found.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter an amount greater than $0.");
  }

  if (amount > goal.saved) {
    throw new Error(
      `You can remove up to $${goal.saved.toFixed(2)} from this goal.`,
    );
  }

  goal.saved = roundCurrency(
    goal.saved - amount,
  );

  kid.transactions.unshift({
    id: crypto.randomUUID(),
    date: today(),
    description: `Removed from ${goal.name}`,
    amount: -roundCurrency(amount),
    bucket: "saving",
    type: "goal",
  });
}

export function deleteGoal(
  state: FamilyBankState,
  slug: string,
  goalId: string,
): void {
  const kid = state.kids[slug];

  if (!kid) {
    throw new Error("Kid account not found.");
  }

  const goalIndex = kid.goals.findIndex(
    (item) => item.id === goalId,
  );

  if (goalIndex < 0) {
    throw new Error("Savings goal not found.");
  }

  const [goal] = kid.goals.splice(goalIndex, 1);

  if (goal.saved > 0) {
    kid.transactions.unshift({
      id: crypto.randomUUID(),
      date: today(),
      description: `Closed ${goal.name} goal`,
      amount: -roundCurrency(goal.saved),
      bucket: "saving",
      type: "goal",
    });
  }
}

export function completeGoalPurchase(
  state: FamilyBankState,
  slug: string,
  goalId: string,
): void {
  const kid = state.kids[slug];

  if (!kid) {
    throw new Error("Kid account not found.");
  }

  const goalIndex = kid.goals.findIndex(
    (item) => item.id === goalId,
  );

  if (goalIndex < 0) {
    throw new Error("Savings goal not found.");
  }

  const goal = kid.goals[goalIndex];

  if (goal.saved < goal.target) {
    throw new Error("This goal is not fully funded yet.");
  }

  if (kid.buckets.saving < goal.target) {
    throw new Error("There is not enough money in Saving.");
  }

  kid.buckets.saving = roundCurrency(
    kid.buckets.saving - goal.target,
  );

  kid.goals.splice(goalIndex, 1);

  kid.transactions.unshift({
    id: crypto.randomUUID(),
    date: today(),
    description: goal.name,
    amount: -roundCurrency(goal.target),
    bucket: "saving",
    type: "purchase",
  });
}
