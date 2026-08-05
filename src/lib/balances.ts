import type { BucketType, Kid } from "../types/index.ts";

export function availableBucketBalance(
  kid: Kid,
  bucket: BucketType,
): number {
  if (bucket !== "saving") return kid.buckets[bucket];

  const allocatedSavings = kid.goals.reduce(
    (total, goal) => total + goal.saved,
    0,
  );

  return Math.max(0, kid.buckets.saving - allocatedSavings);
}
