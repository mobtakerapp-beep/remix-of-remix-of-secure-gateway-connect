/**
 * Server-side Supabase admin client (service role).
 *
 * Unlike the generated `@/integrations/supabase/client.server`, this reads the
 * secrets through `getRuntimeSecret`, so it also works on a self-hosted
 * Cloudflare Worker deployment where secrets arrive as Worker bindings instead
 * of `process.env`.
 */
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { getRuntimeSecret } from "./runtime-env.server";

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

function createSupabaseAdminClient() {
  const url =
    getRuntimeSecret("EXTERNAL_SUPABASE_URL") ??
    getRuntimeSecret("SUPABASE_URL") ??
    getRuntimeSecret("VITE_SUPABASE_URL");
  const serviceKey =
    getRuntimeSecret("EXTERNAL_SUPABASE_SERVICE_KEY") ??
    getRuntimeSecret("SUPABASE_SERVICE_ROLE_KEY") ??
    getRuntimeSecret("MY_SERVICE_KEY");

  if (!url || !serviceKey) {
    const missing = [
      ...(!url ? ["EXTERNAL_SUPABASE_URL"] : []),
      ...(!serviceKey ? ["EXTERNAL_SUPABASE_SERVICE_KEY"] : []),
    ];
    throw new Error(`Missing Supabase environment variable(s): ${missing.join(", ")}.`);
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
