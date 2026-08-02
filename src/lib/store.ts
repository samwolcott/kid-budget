import type {
  BucketType,
  FamilyBankState,
  Kid,
  PurchaseRequest,
} from "../types";

const STORAGE_KEY = "family-bank-state-v1";

export interface AllowanceSplit {
  spending: number;
  saving: number;
  giving: number;
}

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

export function loadState(
  fallbackKids: Record<string, Kid>,
): FamilyBankState {
  const fallback: FamilyBankState = {
    kids: structuredClone(fallbackKids),
    purchaseRequests: [],
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as FamilyBankState;

    if (!parsed?.kids || !parsed?.purchaseRequests) {
      return fallback;
    }

    return parsed;
  } catch {
    return fallback;
  }
}

export function saveState(
  state: FamilyBankState,
): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(state),
  );
}

export function resetState(): void {
  localStorage.removeItem(STORAGE_KEY);
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

  if (kid.buckets[from] < amount) {
    throw new Error(
      `There isn't enough money in ${from}.`,
    );
  }

  kid.buckets[from] = roundCurrency(
    kid.buckets[from] - amount,
  );

  kid.buckets[to] = roundCurrency(
    kid.buckets[to] + amount,
  );

  kid.transactions.unshift({
    id: crypto.randomUUID(),
    date: today(),
    description: `Moved ${from} → ${to}`,
    amount: roundCurrency(amount),
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

