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

let currentStatus: StorageStatus = {
  kind: "local",
  message: "LocalStorage is active.",
};

export function getStorageStatus(): StorageStatus {
  return currentStatus;
}

export function setStorageStatus(status: StorageStatus): void {
  currentStatus = status;
  window.dispatchEvent(new CustomEvent("family-bank-storage-status", {
    detail: status,
  }));
}
