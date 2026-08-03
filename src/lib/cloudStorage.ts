import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AllowanceSplit,
  BucketType,
  FamilyBankState,
  Kid,
  PurchaseRequest,
  TransactionType,
} from "../types";

const CLOUD_CACHE_KEY = "family-bank-cloud-cache-v1";

export interface CloudSnapshot {
  familyId: string;
  revision: number;
  state: FamilyBankState;
  allowanceSplit: AllowanceSplit;
}

interface KidRow {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  allowance_amount_cents: number;
}

function cents(value: unknown): number {
  return Number(value ?? 0) / 100;
}

function requireData<T>(
  result: { data: T | null; error: { message: string } | null },
  message: string,
): T {
  if (result.error || result.data === null) {
    throw new Error(message);
  }

  return result.data;
}

export async function fetchCloudSnapshot(
  client: SupabaseClient,
  familyId: string,
  fallbackKids: Record<string, Kid>,
): Promise<CloudSnapshot> {
  const kidsResult = await client
    .from("kids")
    .select("id, slug, name, emoji, allowance_amount_cents")
    .eq("family_id", familyId)
    .order("name");
  const kidRows = requireData(kidsResult, "We couldn't load the cloud kid accounts.") as KidRow[];
  const kidIds = kidRows.map((kid) => kid.id);

  const emptyResult = { data: [], error: null };
  const [balancesResult, goalsResult, transactionsResult, requestsResult, settingsResult] = await Promise.all([
    kidIds.length
      ? client.from("bucket_balances").select("kid_id, spending_cents, saving_cents, giving_cents").in("kid_id", kidIds)
      : emptyResult,
    kidIds.length
      ? client.from("goals").select("id, kid_id, name, emoji, target_cents, saved_cents, created_at").in("kid_id", kidIds).order("created_at")
      : emptyResult,
    kidIds.length
      ? client.from("transactions").select("id, kid_id, type, bucket, amount_cents, description, created_at").in("kid_id", kidIds).order("created_at", { ascending: false })
      : emptyResult,
    kidIds.length
      ? client.from("purchase_requests").select("id, kid_id, description, amount_cents, bucket, status, requested_at").in("kid_id", kidIds).order("requested_at", { ascending: false })
      : emptyResult,
    client.from("family_settings").select("allowance_spending_percent, allowance_saving_percent, allowance_giving_percent, revision").eq("family_id", familyId).single(),
  ]);

  const balances = requireData(balancesResult, "We couldn't load cloud balances.") as Array<Record<string, unknown>>;
  const goals = requireData(goalsResult, "We couldn't load cloud goals.") as Array<Record<string, unknown>>;
  const transactions = requireData(transactionsResult, "We couldn't load cloud history.") as Array<Record<string, unknown>>;
  const requests = requireData(requestsResult, "We couldn't load cloud purchase requests.") as Array<Record<string, unknown>>;
  const settings = requireData(settingsResult, "We couldn't load cloud family settings.") as Record<string, unknown>;
  const balanceByKid = new Map(balances.map((row) => [String(row.kid_id), row]));
  const kidById = new Map(kidRows.map((kid) => [kid.id, kid]));
  const cloudKids: Record<string, Kid> = {};

  const profiles = kidRows.length > 0
    ? kidRows
    : Object.values(fallbackKids).map((kid) => ({
        id: kid.id,
        slug: kid.slug,
        name: kid.name,
        emoji: kid.emoji,
        allowance_amount_cents: Math.round(kid.allowanceAmount * 100),
      }));

  profiles.forEach((row) => {
    const balance = balanceByKid.get(row.id);

    cloudKids[row.slug] = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      emoji: row.emoji,
      allowanceAmount: cents(row.allowance_amount_cents),
      buckets: {
        spending: cents(balance?.spending_cents),
        saving: cents(balance?.saving_cents),
        giving: cents(balance?.giving_cents),
      },
      goals: goals
        .filter((goal) => goal.kid_id === row.id)
        .map((goal) => ({
          id: String(goal.id),
          name: String(goal.name),
          emoji: String(goal.emoji),
          target: cents(goal.target_cents),
          saved: cents(goal.saved_cents),
        })),
      transactions: transactions
        .filter((transaction) => transaction.kid_id === row.id)
        .map((transaction) => ({
          id: String(transaction.id),
          date: String(transaction.created_at).slice(0, 10),
          description: String(transaction.description),
          amount: cents(transaction.amount_cents),
          bucket: transaction.bucket as BucketType,
          type: transaction.type as TransactionType,
        })),
    };
  });

  const purchaseRequests: PurchaseRequest[] = requests.flatMap((request) => {
    const kid = kidById.get(String(request.kid_id));
    if (!kid) return [];

    return [{
      id: String(request.id),
      kidId: kid.id,
      kidName: kid.name,
      description: String(request.description),
      amount: cents(request.amount_cents),
      bucket: request.bucket as BucketType,
      status: request.status as PurchaseRequest["status"],
      requestedAt: String(request.requested_at),
    }];
  });

  return {
    familyId,
    revision: Number(settings.revision),
    state: { kids: cloudKids, purchaseRequests },
    allowanceSplit: {
      spending: Number(settings.allowance_spending_percent),
      saving: Number(settings.allowance_saving_percent),
      giving: Number(settings.allowance_giving_percent),
    },
  };
}

export function saveCloudCache(snapshot: CloudSnapshot): void {
  localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(snapshot));
}

export function loadCloudCache(familyId: string): CloudSnapshot | null {
  try {
    const raw = localStorage.getItem(CLOUD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CloudSnapshot;
    return parsed?.familyId === familyId
      && Number.isFinite(parsed.revision)
      && parsed?.state?.kids
      && parsed.allowanceSplit
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function isEmptyCloudState(state: FamilyBankState): boolean {
  const kids = Object.values(state.kids);
  return kids.every((kid) =>
    kid.buckets.spending === 0
    && kid.buckets.saving === 0
    && kid.buckets.giving === 0
    && kid.goals.length === 0
    && kid.transactions.length === 0
  ) && state.purchaseRequests.length === 0;
}

export class CloudConflictError extends Error {
  constructor() {
    super("Cloud data changed on another device. Reload before trying again.");
    this.name = "CloudConflictError";
  }
}

function toCents(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("The family state contains an invalid amount.");
  }
  return Math.round((value + Number.EPSILON) * 100);
}

function serializeCloudState(
  state: FamilyBankState,
  allowanceSplit: AllowanceSplit,
) {
  const kids = Object.values(state.kids);
  const kidSlugById = new Map(kids.map((kid) => [kid.id, kid.slug]));

  return {
    kids: kids.map((kid) => ({
      slug: kid.slug,
      name: kid.name,
      emoji: kid.emoji,
      allowance_amount_cents: toCents(kid.allowanceAmount),
      buckets: {
        spending_cents: toCents(kid.buckets.spending),
        saving_cents: toCents(kid.buckets.saving),
        giving_cents: toCents(kid.buckets.giving),
      },
      goals: kid.goals.map((goal) => ({
        id: goal.id,
        name: goal.name,
        emoji: goal.emoji,
        target_cents: toCents(goal.target),
        saved_cents: toCents(goal.saved),
      })),
      transactions: kid.transactions.map((transaction) => ({
        id: transaction.id,
        date: transaction.date,
        description: transaction.description,
        amount_cents: toCents(transaction.amount),
        bucket: transaction.bucket,
        type: transaction.type,
      })),
    })),
    purchase_requests: state.purchaseRequests.map((request) => ({
      id: request.id,
      kid_slug: kidSlugById.get(request.kidId),
      description: request.description,
      amount_cents: toCents(request.amount),
      bucket: request.bucket,
      status: request.status,
      requested_at: request.requestedAt,
    })),
    allowance_split: allowanceSplit,
  };
}

export async function saveCloudState(
  client: SupabaseClient,
  snapshot: CloudSnapshot,
  state: FamilyBankState,
  allowanceSplit: AllowanceSplit,
): Promise<void> {
  const payload = serializeCloudState(state, allowanceSplit);

  if (payload.purchase_requests.some((request) => !request.kid_slug)) {
    throw new Error("A purchase request does not match a cloud kid account.");
  }

  const { error } = await client.rpc("save_cloud_family_state", {
    expected_revision: snapshot.revision,
    state_payload: payload,
  });

  if (error?.code === "40001") throw new CloudConflictError();
  if (error) throw new Error(error.message || "The cloud save failed.");
}
