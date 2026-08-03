import type {
  AllowanceSplit,
  FamilyBankState,
  Kid,
} from "../types";

const STORAGE_KEY = "family-bank-state-v1";
const SPLIT_STORAGE_KEY = "family-bank-allowance-split-v1";

export interface StateRepository {
  load(
    fallbackKids: Record<string, Kid>,
  ): Promise<FamilyBankState>;
  save(state: FamilyBankState): Promise<void>;
  reset(): Promise<void>;
  loadAllowanceSplit(
    fallback: AllowanceSplit,
  ): Promise<AllowanceSplit>;
  saveAllowanceSplit(split: AllowanceSplit): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export function createFallbackState(
  fallbackKids: Record<string, Kid>,
): FamilyBankState {
  return {
    kids: structuredClone(fallbackKids),
    purchaseRequests: [],
  };
}

export class LocalStorageStateRepository
implements StateRepository {
  async load(
    fallbackKids: Record<string, Kid>,
  ): Promise<FamilyBankState> {
    let raw: string | null;

    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      throw new StorageError(
        "Unable to read saved family data on this device.",
      );
    }

    if (!raw) {
      return createFallbackState(fallbackKids);
    }

    let parsed: FamilyBankState;

    try {
      parsed = JSON.parse(raw) as FamilyBankState;
    } catch {
      throw new StorageError(
        "Saved family data is damaged. Showing the demo data instead.",
      );
    }

    if (!parsed?.kids || !Array.isArray(parsed.purchaseRequests)) {
      throw new StorageError(
        "Saved family data is incomplete. Showing the demo data instead.",
      );
    }

    Object.entries(parsed.kids).forEach(([slug, kid]) => {
      const configuredKid = fallbackKids[slug];

      if (configuredKid) {
        kid.allowanceAmount = configuredKid.allowanceAmount;
      }
    });

    return parsed;
  }

  async save(state: FamilyBankState): Promise<void> {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(state),
      );
    } catch {
      throw new StorageError(
        "Unable to save your changes on this device.",
      );
    }
  }

  async reset(): Promise<void> {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      throw new StorageError(
        "Unable to reset the saved family data on this device.",
      );
    }
  }

  async loadAllowanceSplit(
    fallback: AllowanceSplit,
  ): Promise<AllowanceSplit> {
    let raw: string | null;

    try {
      raw = localStorage.getItem(SPLIT_STORAGE_KEY);
    } catch {
      throw new StorageError(
        "Unable to read the saved allowance split.",
      );
    }

    if (!raw) return fallback;

    try {
      const split = JSON.parse(raw) as AllowanceSplit;
      const total = split.spending + split.saving + split.giving;

      if (
        Number.isFinite(total) &&
        Math.abs(total - 100) < 0.001
      ) {
        return split;
      }
    } catch {
      // The clear error below handles invalid JSON and invalid values.
    }

    throw new StorageError(
      "The saved allowance split is invalid. Using 70/20/10 instead.",
    );
  }

  async saveAllowanceSplit(split: AllowanceSplit): Promise<void> {
    try {
      localStorage.setItem(
        SPLIT_STORAGE_KEY,
        JSON.stringify(split),
      );
    } catch {
      throw new StorageError(
        "Unable to save the allowance split on this device.",
      );
    }
  }
}
