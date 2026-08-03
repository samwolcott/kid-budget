export type BucketType = "spending" | "saving" | "giving";
export interface BucketBalances { spending: number; saving: number; giving: number; }
export interface AllowanceSplit { spending: number; saving: number; giving: number; }
export interface Goal { id: string; name: string; emoji: string; saved: number; target: number; }
export type TransactionType = "allowance" | "purchase" | "transfer" | "goal" | "adjustment";
export interface Transaction { id: string; date: string; description: string; amount: number; bucket: BucketType; type: TransactionType; }
export interface PurchaseRequest {
  id: string; kidId: string; kidName: string; description: string; amount: number;
  bucket: BucketType; status: "pending" | "approved" | "declined"; requestedAt: string;
}
export interface Kid {
  id: string; slug: string; name: string; emoji: string; allowanceAmount: number;
  buckets: BucketBalances; goals: Goal[]; transactions: Transaction[];
}
export interface FamilyBankState { kids: Record<string, Kid>; purchaseRequests: PurchaseRequest[]; }
