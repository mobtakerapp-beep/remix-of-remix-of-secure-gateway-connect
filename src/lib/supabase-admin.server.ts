/**
 * Server-side Supabase admin client (service role).
 * Safely reads key dynamically at runtime to prevent Vite build-time stripping.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (isNewSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function getSecretKey(): string | undefined {
  // قراءة ديناميكية تمنع Vite من مسح المتغير أو تحويله لـ undefined أثناء الـ Build
  const dynamicEnv = process["env"];
  return (
    dynamicEnv?.SUPABASE_SERVICE_ROLE_KEY ||
    (globalThis as any)?.process?.env?.SUPABASE_SERVICE_ROLE_KEY ||
    (globalThis as any)?.__env__?.SUPABASE_SERVICE_ROLE_KEY
  );
}

function createSupabaseAdminClient() {
  const url = "https://sajkxtqcaiubmtamenke.supabase.co";
  
  const serviceKey = getSecretKey();

  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing from environment variables");
  }

  return createClient<Database>(url, serviceKey, {
    global: { fetch: createSupabaseFetch(serviceKey) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
