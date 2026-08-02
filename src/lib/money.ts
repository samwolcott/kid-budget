import type { BucketBalances } from "../types";

export function totalBalance(buckets: BucketBalances): number {
  return buckets.spending + buckets.saving + buckets.giving;
}

export function allowanceSplit(amount: number) {
  const spending = roundCurrency(amount * 0.7);
  const saving = roundCurrency(amount * 0.2);
  const giving = roundCurrency(amount - spending - saving);

  return {
    spending,
    saving,
    giving,
  };
}

export function goalPercent(saved: number, target: number): number {
  if (target <= 0) return 0;

  return Math.min(100, Math.max(0, (saved / target) * 100));
}

export function roundCurrency(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
