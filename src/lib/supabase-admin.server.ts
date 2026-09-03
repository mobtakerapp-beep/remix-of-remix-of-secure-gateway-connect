import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getRuntimeSecret } from "./runtime-env.server";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request
        ? input.headers
        : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => {
        headers.set(key, value);
      });
    }

    const authorizationHeader = headers.get("Authorization");
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      authorizationHeader === "Bearer " + supabaseKey
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function getSecretKey(): string | undefined {
  return getRuntimeSecret("SUPABASE_SERVICE_ROLE_KEY");
}

function getSupabaseUrl(): string | undefined {
  return (
    getRuntimeSecret("EXTERNAL_SUPABASE_URL") ||
    getRuntimeSecret("SUPABASE_URL")
  );
}

export function createSupabaseAdminClient() {
  const url = getSupabaseUrl();
  const serviceKey = getSecretKey();

  if (!url) {
    throw new Error("SUPABASE_URL is missing from environment variables");
  }

  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing from environment variables",
    );
  }

  return createClient<Database>(url, serviceKey, {
    global: {
      fetch: createSupabaseFetch(serviceKey),
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Keep lazy runtime secret loading for Cloudflare, but always bind Supabase
// methods to the real client. This avoids calling methods with the Proxy as
// `this`, which can produce cryptic runtime errors during server functions.
export const supabaseAdmin = new Proxy(
  {} as ReturnType<typeof createSupabaseAdminClient>,
  {
    get(_target, prop) {
      const client = createSupabaseAdminClient();
      const value = Reflect.get(client, prop, client);
      return typeof value === "function" ? value.bind(client) : value;
    },
  },
);
