/**
 * Server-side Supabase admin client (service role).
 * Safely accesses Cloudflare Pages runtime secrets via Vinxi/H3 event context.
 */
import { createClient } from "@supabase/supabase-js";
import { getEvent } from "vinxi/http";
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
  // 1. محاولة القراءة من سياق الطلب الخاص بـ Cloudflare Pages (السبب الرئيسي للحل)
  try {
    const event = getEvent();
    if (event?.context) {
      const cfEnv = (event.context as any).cloudflare?.env || (event.context as any).env;
      if (cfEnv?.SUPABASE_SERVICE_ROLE_KEY) {
        return cfEnv.SUPABASE_SERVICE_ROLE_KEY;
      }
    }
  } catch {
    // خارج نطاق الـ Request
  }

  // 2. محاولة القراءة من process.env (للتجربة المحلية لو موجودة)
  if (typeof process !== "undefined" && process.env?.SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  // 3. محاولة أليفة أخيرة من globalThis في Cloudflare
  return (globalThis as any)?.SUPABASE_SERVICE_ROLE_KEY || (globalThis as any)?.env?.SUPABASE_SERVICE_ROLE_KEY;
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
