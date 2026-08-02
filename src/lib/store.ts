import type {
  BucketType,
  FamilyBankState,
  Kid,
  PurchaseRequest,
} from "../types";

const STORAGE_KEY = "family-bank-state-v1";

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
  slugs: string[],
): void {
  if (slugs.length === 0) {
    throw new Error("Choose at least one child.");
  }

  for (const slug of slugs) {
    const kid = state.kids[slug];

    if (!kid) {
      continue;
    }

    const total = roundCurrency(
      kid.allowanceAmount,
    );

    const spending = roundCurrency(
      total * 0.7,
    );

    const saving = roundCurrency(
      total * 0.2,
    );

    /*
     * Giving receives the remainder so the three
     * amounts always add back to the allowance total.
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
