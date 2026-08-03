export type StorageMode = "local" | "cloud";

export type StorageStatusKind =
  | "local"
  | "loading"
  | "cloud"
  | "saving"
  | "conflict"
  | "empty"
  | "cached"
  | "offline";

export interface StorageStatus {
  kind: StorageStatusKind;
  message: string;
}

const MODE_KEY = "family-bank-storage-mode-v1";
let currentStatus: StorageStatus = {
  kind: "local",
  message: "LocalStorage is active.",
};

export function getStorageMode(): StorageMode {
  try {
    return localStorage.getItem(MODE_KEY) === "cloud"
      ? "cloud"
      : "local";
  } catch {
    return "local";
  }
}

export function setStorageMode(mode: StorageMode): void {
  localStorage.setItem(MODE_KEY, mode);
}

export function getStorageStatus(): StorageStatus {
  return currentStatus;
}

export function setStorageStatus(status: StorageStatus): void {
  currentStatus = status;
  window.dispatchEvent(new CustomEvent("family-bank-storage-status", {
    detail: status,
  }));
}
