import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAppAuth } from "@/lib/app-auth-middleware";

export type CodeRow = {
  id: string;
  code: string;
  plan: string;
  durationDays: number;
  maxUses: number;
  usedCount: number;
  note: string | null;
  active: boolean;
  createdAt: string;
};

const ADMIN_EMAIL = "uuxz272@gmail.com";

function isConfiguredAdminEmail(email: unknown) {
  return typeof email === "string" && email.trim().toLowerCase() === ADMIN_EMAIL;
}

function getClaimEmail(claims: unknown) {
  if (!claims || typeof claims !== "object" || !("email" in claims)) return undefined;
  const email = (claims as { email?: unknown }).email;
  return typeof email === "string" ? email : undefined;
}

type UserScopedClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

/** Checks the admin role using the caller's own session (no service key needed). */
async function hasAdminRole(supabase: unknown, userId: string) {
  try {
    const client = supabase as UserScopedClient | undefined;
    if (client?.rpc) {
      const { data, error } = await client.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (!error && data) return true;
      if (!error) return false;
    }
  } catch {
    // fall through to the service client
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    return Boolean(data);
  } catch {
    return false;
  }
}

async function assertAdmin(userId: string, email?: unknown, supabase?: unknown) {
  if (isConfiguredAdminEmail(email)) return;
  if (!(await hasAdminRole(supabase, userId))) throw new Error("Forbidden");
}

export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .handler(async ({ context }) => {
    if (isConfiguredAdminEmail(getClaimEmail(context.claims))) {
      return { isAdmin: true };
    }
    return { isAdmin: await hasAdminRole(context.supabase, context.userId) };
  });

/** Redeem an activation code — binds the subscription to the signed-in account. */
export const redeemCode = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator((input: unknown) =>
    z
      .object({
        code: z.string().min(4).max(64),
        device: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code.trim().toUpperCase();

    const { data: row } = await supabaseAdmin
      .from("activation_codes")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (!row || !row.active) return { ok: false as const, reason: "invalid" };

    // A code that has never been used cannot expire: its validity window only
    // starts on first activation.
    const neverUsed = (row.used_count ?? 0) === 0;
    if (!neverUsed && row.expires_at && new Date(row.expires_at) < new Date())
      return { ok: false as const, reason: "expired" };

    const { data: mine } = await supabaseAdmin
      .from("code_redemptions")
      .select("id")
      .eq("code_id", row.id)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!mine && (row.used_count ?? 0) >= row.max_uses)
      return { ok: false as const, reason: "used_up" };

    if (!mine) {
      await supabaseAdmin.from("code_redemptions").insert({
        code_id: row.id,
        user_id: context.userId,
        device_fingerprint: data.device ?? null,
      });
      const codeExpiry = new Date();
      codeExpiry.setDate(codeExpiry.getDate() + (row.duration_days ?? 30));
      await supabaseAdmin
        .from("activation_codes")
        .update(
          neverUsed && row.max_uses <= 1
            ? { used_count: (row.used_count ?? 0) + 1, expires_at: codeExpiry.toISOString() }
            : { used_count: (row.used_count ?? 0) + 1 },
        )

        .eq("id", row.id);

    }


    const expires = new Date();
    expires.setDate(expires.getDate() + (row.duration_days ?? 30));

    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();

    const payload = {
      user_id: context.userId,
      plan: row.plan,
      status: "active",
      expires_at: expires.toISOString(),
      generations_used: 0,
      reset_at: new Date().toISOString(),
    };

    if (existing) {
      await supabaseAdmin.from("subscriptions").update(payload).eq("user_id", context.userId);
    } else {
      await supabaseAdmin.from("subscriptions").insert(payload);
    }

    return { ok: true as const, plan: row.plan, expiresAt: expires.toISOString() };
  });

export const adminListCodes = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .handler(async ({ context }): Promise<CodeRow[]> => {
    await assertAdmin(context.userId, getClaimEmail(context.claims), context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("activation_codes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    return (data ?? []).map((r) => ({
      id: r.id,
      code: r.code,
      plan: r.plan,
      durationDays: r.duration_days,
      maxUses: r.max_uses,
      usedCount: r.used_count,
      note: r.note,
      active: r.active,
      createdAt: r.created_at,
    }));
  });

export const adminCreateCodes = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator((input: unknown) =>
    z
      .object({
        count: z.number().int().min(1).max(50),
        plan: z.enum(["monthly", "yearly"]),
        durationDays: z.number().int().min(1).max(3650),
        maxUses: z.number().int().min(1).max(1000),
        note: z.string().max(200).optional(),
        notes: z.array(z.string().max(200)).max(50).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId, getClaimEmail(context.claims), context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const gen = () => {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    };
    const rows = Array.from({ length: data.count }, (_unused, i) => ({
      code: gen(),
      plan: data.plan,
      duration_days: data.durationDays,
      max_uses: data.maxUses,
      note: data.notes?.[i]?.trim() || data.note?.trim() || null,
      created_by: context.userId,
    }));
    const { data: inserted } = await supabaseAdmin
      .from("activation_codes")
      .insert(rows)
      .select("code");
    return { codes: (inserted ?? []).map((r) => r.code) };
  });

export type RedemptionRow = {
  id: string;
  code: string;
  plan: string;
  note: string | null;
  userId: string;
  userEmail: string | null;
  device: string | null;
  redeemedAt: string;
  subscriptionExpiresAt: string | null;
};

/** Admin: list code redemptions with the subscriber's email and current expiry. */
export const adminListRedemptions = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .handler(async ({ context }): Promise<RedemptionRow[]> => {
    await assertAdmin(context.userId, getClaimEmail(context.claims), context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: redemptions } = await supabaseAdmin
      .from("code_redemptions")
      .select(
        "id, user_id, device_fingerprint, created_at, activation_codes(code, plan, note, duration_days)",
      )
      .order("created_at", { ascending: false })
      .limit(300);

    const rows = redemptions ?? [];
    const userIds = [...new Set(rows.map((r) => r.user_id))];

    const emailById = new Map<string, string>();
    if (userIds.length > 0) {
      try {
        for (let page = 1; page <= 10; page++) {
          const { data: usersPage, error } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage: 1000,
          });
          if (error) throw error;
          for (const u of usersPage?.users ?? []) {
            if (u.email) emailById.set(u.id, u.email);
          }
          if ((usersPage?.users?.length ?? 0) < 1000) break;
        }
      } catch (e) {
        console.error("[adminListRedemptions] listUsers failed", e);
      }
    }

    const expiryById = new Map<string, string | null>();
    if (userIds.length > 0) {
      const { data: subs } = await supabaseAdmin
        .from("subscriptions")
        .select("user_id, expires_at, plan")
        .in("user_id", userIds);
      for (const s of subs ?? []) {
        if (s.plan !== "free") expiryById.set(s.user_id, s.expires_at);
      }
    }

    return rows.map((r) => {
      const codeRow = Array.isArray(r.activation_codes)
        ? r.activation_codes[0]
        : r.activation_codes;
      // The validity window starts at first use (redemption time). Fall back to
      // redeemedAt + duration when the subscription row is missing.
      let expiresAt = expiryById.get(r.user_id) ?? null;
      if (!expiresAt) {
        const fallback = new Date(r.created_at);
        fallback.setDate(fallback.getDate() + (codeRow?.duration_days ?? 30));
        expiresAt = fallback.toISOString();
      }
      return {
        id: r.id,
        code: codeRow?.code ?? "—",
        plan: codeRow?.plan ?? "—",
        note: codeRow?.note ?? null,
        userId: r.user_id,
        userEmail: emailById.get(r.user_id) ?? null,
        device: r.device_fingerprint,
        redeemedAt: r.created_at,
        subscriptionExpiresAt: expiresAt,
      };
    });
  });

export const adminSetCodeActive = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId, getClaimEmail(context.claims), context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("activation_codes").update({ active: data.active }).eq("id", data.id);
    return { ok: true };
  });

export type OwnerCredentials = { email: string; serial: string };

/**
 * Fixed owner credentials, resolved from the database (activation_codes) so the
 * email + serial are always available and never depend on local state that is
 * lost when the page changes.
 */
export const getOwnerCredentials = createServerFn({ method: "GET" }).handler(
  async (): Promise<OwnerCredentials> => {
    const fallback: OwnerCredentials = { email: "UUxz272@gmail.com", serial: "UUXZ@272" };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("activation_codes")
        .select("code")
        .eq("code", fallback.serial)
        .maybeSingle();
      return { email: fallback.email, serial: data?.code ?? fallback.serial };
    } catch {
      return fallback;
    }
  },
);
