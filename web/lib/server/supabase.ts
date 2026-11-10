import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "documents";

let client: SupabaseClient | null = null;
let expiresAt = 0;

export const storageConfigured = () =>
  !!(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SERVER_PASSWORD);

/**
 * Supabase client signed in as the CarPass server account. Row-level security
 * lets only that account read or write documents, and the browser never talks
 * to Supabase. Returns null when storage is not configured or sign-in fails.
 */
export async function supabase(): Promise<SupabaseClient | null> {
  if (!storageConfigured()) return null;
  if (client && Date.now() < expiresAt) return client;
  const next = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await next.auth.signInWithPassword({
    email: process.env.SUPABASE_SERVER_EMAIL || "server@carpass.invalid",
    password: process.env.SUPABASE_SERVER_PASSWORD!,
  });
  if (error || !data.session) {
    console.error("supabase sign-in failed", error?.message);
    return null;
  }
  client = next;
  // Sign in again a minute before the token runs out.
  expiresAt = Date.now() + (data.session.expires_in - 60) * 1000;
  return client;
}
