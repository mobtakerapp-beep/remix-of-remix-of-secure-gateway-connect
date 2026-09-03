/**
 * Browser-side admin helpers.
 */
import { supabase } from "@/integrations/supabase/client";
import type { CodeRow, RedemptionRow } from "@/lib/access.functions";

const ADMIN_EMAIL = "uuxz272@gmail.com";

export async function isAdminClient(): Promise<boolean> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return false;
  if ((user.email ?? "").trim().toLowerCase() === ADMIN_EMAIL) return true;
  const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (data) return true;
  const { data: row } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  return Boolean(row);
}

export async function listCodesClient(): Promise<CodeRow[]> {
  const { data, error } = await supabase.from("activation_codes").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, code: r.code, plan: r.plan, durationDays: r.duration_days, maxUses: r.max_uses, usedCount: r.used_count, note: r.note, active: r.active, createdAt: r.created_at }));
}

export async function listRedemptionsClient(): Promise<RedemptionRow[]> {
  const { data, error } = await supabase.from("code_redemptions").select("id, user_id, device_fingerprint, created_at, activation_codes(code, plan, note, duration_days)").order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  const rows = data ?? [];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const expiryById = new Map<string, string | null>();
  const emailById = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: subs } = await supabase.from("subscriptions").select("user_id, expires_at").in("user_id", userIds);
    for (const s of subs ?? []) expiryById.set(s.user_id, s.expires_at);
    const { data: profiles } = await supabase.from("profiles").select("id, teacher_name").in("id", userIds);
    for (const p of profiles ?? []) emailById.set(p.id, p.teacher_name || null);
  }
  return rows.map((r) => {
    const codeRow = Array.isArray(r.activation_codes) ? r.activation_codes[0] : r.activation_codes;
    const fallback = new Date(r.created_at);
    fallback.setDate(fallback.getDate() + (codeRow?.duration_days ?? 30));
    return {
      id: r.id,
      code: codeRow?.code ?? "—",
      plan: codeRow?.plan ?? "—",
      durationDays: codeRow?.duration_days ?? 30,
      note: codeRow?.note ?? null,
      userId: r.user_id,
      userEmail: emailById.get(r.user_id) ?? null,
      device: r.device_fingerprint,
      redeemedAt: r.created_at,
      subscriptionExpiresAt: expiryById.get(r.user_id) ?? fallback.toISOString(),
    };
  });
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export async function createCodesClient(input: {
  count: number;
  plan: "monthly" | "yearly" | "standard" | "premium";
  durationDays: number;
  maxUses: number;
  note?: string;
  notes?: string[];
}): Promise<{ codes: string[] }> {
  const { data: userData } = await supabase.auth.getUser();
  const normalizedPlan = input.plan === "standard" || input.plan === "monthly" ? "standard" : "premium";
  const rows = Array.from({ length: input.count }, (_u, i) => ({
    code: generateCode(),
    plan: normalizedPlan,
    duration_days: input.durationDays,
    max_uses: input.maxUses,
    note: input.notes?.[i]?.trim() || input.note?.trim() || null,
    created_by: userData.user?.id ?? null,
  }));
  const { data, error } = await supabase.from("activation_codes").insert(rows).select("code");
  if (error) throw error;
  return { codes: (data ?? []).map((r) => r.code) };
}

export async function setCodeActiveClient(id: string, active: boolean) {
  const { error } = await supabase.from("activation_codes").update({ active }).eq("id", id);
  if (error) throw error;
  return { ok: true };
}
