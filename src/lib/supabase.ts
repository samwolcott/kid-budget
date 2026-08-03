import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = import.meta.env.PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    client = null;
    return client;
  }

  client = createClient(url, publishableKey);
  return client;
}
