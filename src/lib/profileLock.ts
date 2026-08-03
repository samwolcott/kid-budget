import type { SupabaseClient } from "@supabase/supabase-js";

export type ProfileSlug = "parent" | "judah" | "max";

export interface LockProfile {
  slug: "judah" | "max";
  name: string;
  emoji: string;
}

export interface ProfileLockState {
  configured: boolean;
  profiles: LockProfile[];
}

const UNLOCK_PREFIX = "family-bank-profile-unlock-v1:";
const REMEMBERED_PROFILE_KEY = "family-bank-remembered-profile-v1";

export async function loadProfileLockState(
  client: SupabaseClient,
): Promise<ProfileLockState> {
  const { data, error } = await client.rpc("get_profile_lock_state");

  if (error || !data || typeof data !== "object") {
    throw new Error("We couldn't load the family PINs.");
  }

  const value = data as Partial<ProfileLockState>;

  return {
    configured: value.configured === true,
    profiles: Array.isArray(value.profiles) ? value.profiles : [],
  };
}

export async function setupProfilePins(
  client: SupabaseClient,
  pins: Record<ProfileSlug, string>,
): Promise<void> {
  const { error } = await client.rpc("setup_profile_pins", {
    parent_pin: pins.parent,
    judah_pin: pins.judah,
    max_pin: pins.max,
  });

  if (error) {
    throw new Error(error.message || "We couldn't save the family PINs.");
  }
}

export async function verifyProfilePin(
  client: SupabaseClient,
  profile: ProfileSlug,
  pin: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("verify_profile_pin", {
    profile_slug: profile,
    supplied_pin: pin,
  });

  if (error) throw new Error("We couldn't check that PIN. Please try again.");
  return data === true;
}

export function unlockProfile(
  profile: ProfileSlug,
  familyId: string,
): void {
  sessionStorage.setItem(`${UNLOCK_PREFIX}${profile}`, familyId);
}

export function isProfileUnlocked(
  profile: ProfileSlug,
  familyId: string,
): boolean {
  return sessionStorage.getItem(`${UNLOCK_PREFIX}${profile}`) === familyId;
}

export function lockProfile(profile: ProfileSlug): void {
  sessionStorage.removeItem(`${UNLOCK_PREFIX}${profile}`);
}

export function clearProfileUnlocks(): void {
  (["parent", "judah", "max"] as ProfileSlug[]).forEach(lockProfile);
}

export function rememberKidProfile(profile: "judah" | "max" | null): void {
  if (profile) {
    localStorage.setItem(REMEMBERED_PROFILE_KEY, profile);
  } else {
    localStorage.removeItem(REMEMBERED_PROFILE_KEY);
  }
}

export function getRememberedKidProfile(): "judah" | "max" | null {
  const profile = localStorage.getItem(REMEMBERED_PROFILE_KEY);
  return profile === "judah" || profile === "max" ? profile : null;
}
