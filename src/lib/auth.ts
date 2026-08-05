import type {
  Session,
  SupabaseClient,
  User,
} from "@supabase/supabase-js";

export interface ParentFamily {
  id: string;
  name: string;
}

export interface ParentAccount {
  session: Session;
  family: ParentFamily;
}

export async function loadParentAccount(
  client: SupabaseClient,
): Promise<ParentAccount | null> {
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw new Error("We couldn't restore your parent session. Please sign in again.");
  }

  if (!data.session) return null;

  return {
    session: data.session,
    family: await loadOrCreateFamily(client, data.session.user),
  };
}

export async function signInParent(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<ParentAccount> {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    throw new Error(error?.message ?? "Unable to sign in.");
  }

  return {
    session: data.session,
    family: await loadOrCreateFamily(client, data.user),
  };
}

export async function createParentAccount(
  client: SupabaseClient,
  email: string,
  password: string,
  emailRedirectTo: string,
): Promise<ParentAccount | null> {
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo },
  });

  if (error) throw new Error(error.message);
  if (!data.session || !data.user) return null;

  return {
    session: data.session,
    family: await loadOrCreateFamily(client, data.user),
  };
}

export async function signOutParent(
  client: SupabaseClient,
): Promise<void> {
  const { error } = await client.auth.signOut();

  if (error) throw new Error(error.message);
}

export async function requestParentPasswordReset(
  client: SupabaseClient,
  email: string,
  redirectTo: string,
): Promise<void> {
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) throw new Error(error.message);
}

export async function updateParentPassword(
  client: SupabaseClient,
  password: string,
): Promise<void> {
  const { error } = await client.auth.updateUser({ password });

  if (error) throw new Error(error.message);
}

async function loadOrCreateFamily(
  client: SupabaseClient,
  user: User,
): Promise<ParentFamily> {
  const { data: membership, error: membershipError } = await client
    .from("family_members")
    .select("family_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    throw new Error("We couldn't load your family account.");
  }

  let familyId = membership?.family_id as string | undefined;

  if (!familyId) {
    const { data, error } = await client.rpc("create_family", {
      family_name: "The Family Bank",
    });

    if (error || typeof data !== "string") {
      throw new Error("We couldn't create your family account.");
    }

    familyId = data;
  }

  const { data: family, error: familyError } = await client
    .from("families")
    .select("id, name")
    .eq("id", familyId)
    .single();

  if (familyError || !family) {
    throw new Error("We couldn't finish loading your family account.");
  }

  return {
    id: family.id as string,
    name: family.name as string,
  };
}
