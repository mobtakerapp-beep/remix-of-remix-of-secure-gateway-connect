/**
 * Server-side Supabase admin client (service role).
 * Safe runtime environment reader without external build dependencies.
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
  // قراءة بالـ Bracket Notation لتجنب حذف Vite للمتغير أثناء البناء
  if (typeof process !== "undefined" && process?.env) {
    const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (key) return key;
  }

  // دعم مباشر لبيئة Cloudflare Workers / Edge
  const g = globalThis as any;
  return g?.process?.env?.["SUPABASE_SERVICE_ROLE_KEY"] || g?.env?.["SUPABASE_SERVICE_ROLE_KEY"];
}

export function createSupabaseAdminClient() {
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

export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    const client = createSupabaseAdminClient();
    return Reflect.get(client, prop, receiver);
  },
});
