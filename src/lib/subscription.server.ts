import type { Database } from "@/integrations/supabase/types";

type SupabaseClient = ReturnType<typeof import("@supabase/supabase-js").createClient<Database>>;

export type SubscriptionStatus = {
  plan: "free" | "standard" | "premium";
  status: "active" | "expired" | "cancelled" | "pending";
  generationsUsed: number;
  generationsLimit: number;
  canGenerate: boolean;
  teacherName: string;
  school: string;
  email: string;
  remainingToday: number;
  expiresAt: string | null;
  daysRemaining: number | null;
};

const FREE_TOTAL_LIMIT = 1;
const STANDARD_DAILY_LIMIT = 2;
const PREMIUM_DAILY_LIMIT = 4;
const UNLIMITED_LIMIT = 999999;

const FREE_GENERATION_LOG_CAP = 1;
const STANDARD_GENERATION_LOG_CAP = 2;
const PREMIUM_GENERATION_LOG_CAP = 4;

function isSameDay(a: Date, b: Date) { return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate(); }
function normalizePlan(raw: string | null | undefined): "free" | "standard" | "premium" { if (raw === "standard" || raw === "monthly") return "standard"; if (raw === "premium" || raw === "yearly") return "premium"; return "free"; }
function dailyLimitForPlan(plan: "free" | "standard" | "premium") { return plan === "premium" ? PREMIUM_DAILY_LIMIT : plan === "standard" ? STANDARD_DAILY_LIMIT : FREE_TOTAL_LIMIT; }

async function recoverPaidSubscriptionFromRedemption(userId: string, currentSub: Database["public"]["Tables"]["subscriptions"]["Row"] | null) {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase-admin.server");
    const { data: redemptions } = await supabaseAdmin.from("code_redemptions").select("created_at, activation_codes(plan, duration_days, note)").eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
    const now = new Date();
    for (const redemption of redemptions ?? []) {
      const code = Array.isArray(redemption.activation_codes) ? redemption.activation_codes[0] : redemption.activation_codes;
      const note = code?.note ?? "";
      if (note.trim().toUpperCase().startsWith("[GIFT]")) continue;
      const plan = normalizePlan(code?.plan);
      if (plan === "free") continue;
      const redeemedAt = new Date(redemption.created_at);
      const durationDays = Math.max(1, Number(code?.duration_days ?? 30));
      const expires = new Date(redeemedAt);
      expires.setDate(expires.getDate() + durationDays);
      if (expires <= now) continue;
      const currentExpiry = currentSub?.expires_at ? new Date(currentSub.expires_at) : null;
      const needsRepair = !currentSub || normalizePlan(currentSub.plan) !== plan || currentSub.status !== "active" || !currentExpiry || currentExpiry <= now;
      if (!needsRepair) return currentSub;
      const payload = { user_id: userId, plan, status: "active", expires_at: expires.toISOString(), generations_used: currentSub?.generations_used ?? 0, reset_at: currentSub?.reset_at ?? now.toISOString() };
      if (currentSub) await supabaseAdmin.from("subscriptions").update(payload).eq("user_id", userId);
      else await supabaseAdmin.from("subscriptions").insert(payload);
      const { data: repaired } = await supabaseAdmin.from("subscriptions").select("*").eq("user_id", userId).maybeSingle();
      return repaired ?? currentSub;
    }
    return currentSub;
  } catch (error) { console.error("recoverPaidSubscriptionFromRedemption failed", error); return currentSub; }
}

export async function getSubscriptionStatus(supabase: SupabaseClient, userId: string): Promise<SubscriptionStatus> {
  let [subResult, profileResult, userResult] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!subResult.data || !profileResult.data) {
    await supabase.rpc("bootstrap_account", { _user_id: userId });
    [subResult, profileResult] = await Promise.all([supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(), supabase.from("profiles").select("*").eq("id", userId).maybeSingle()]);
  }
  const profile = profileResult.data;
  const email = userResult.data?.user?.email ?? "";
  const isAdmin = email === "uuxz272@gmail.com" || userId === "3494f40c-adb0-4a3c-b101-27bd69a5b999";
  const repairedSub = isAdmin ? subResult.data : await recoverPaidSubscriptionFromRedemption(userId, subResult.data);
  const sub = repairedSub ?? subResult.data;
  const now = new Date();
  let plan: "free" | "standard" | "premium" = "free";
  let status: SubscriptionStatus["status"] = "active";
  let generationsUsed = 0;
  let generationsLimit = isAdmin ? UNLIMITED_LIMIT : FREE_TOTAL_LIMIT;
  let resetAt = now;
  if (sub) {
    plan = normalizePlan(sub.plan);
    status = sub.status as SubscriptionStatus["status"];
    generationsUsed = sub.generations_used ?? 0;
    resetAt = new Date(sub.reset_at ?? now.toISOString());
    if (isAdmin) { plan = "premium"; status = "active"; generationsLimit = UNLIMITED_LIMIT; }
    else if (plan !== "free" && sub.expires_at) {
      const expiry = new Date(sub.expires_at); expiry.setHours(23, 59, 59, 999);
      if (expiry < now) { status = "expired"; plan = "free"; generationsLimit = FREE_TOTAL_LIMIT; }
      else generationsLimit = dailyLimitForPlan(plan);
    } else generationsLimit = dailyLimitForPlan(plan);
    if (plan !== "free" && !isSameDay(resetAt, now)) { generationsUsed = 0; await supabase.from("subscriptions").update({ generations_used: 0, reset_at: now.toISOString() }).eq("user_id", userId); }
  }
  const canGenerate = isAdmin ? true : generationsUsed < generationsLimit;
  const expiresAt = plan === "free" ? null : sub?.expires_at ?? null;
  const daysRemaining = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86400000)) : null;
  return { plan, status, generationsUsed, generationsLimit, canGenerate, teacherName: profile?.teacher_name ?? "", school: profile?.school ?? "", email, remainingToday: isAdmin ? UNLIMITED_LIMIT : Math.max(0, generationsLimit - generationsUsed), expiresAt, daysRemaining };
}

export async function incrementGenerationUsage(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data: user } = await supabase.auth.getUser(); const email = user.user?.email ?? ""; const isAdmin = email === "uuxz272@gmail.com" || userId === "3494f40c-adb0-4a3c-b101-27bd69a5b999"; if (isAdmin) return;
  const { data: sub } = await supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(); if (!sub) return;
  const now = new Date(); const resetAt = new Date(sub.reset_at ?? now.toISOString()); const shouldReset = sub.plan !== "free" && !isSameDay(resetAt, now);
  await supabase.from("subscriptions").update({ generations_used: shouldReset ? 1 : (sub.generations_used ?? 0) + 1, reset_at: shouldReset ? now.toISOString() : sub.reset_at }).eq("user_id", userId);
}

export async function checkGenerationLogCap(supabase: SupabaseClient, userId: string, plan: "free" | "standard" | "premium"): Promise<{ ok: boolean; count: number; cap: number }> {
  const { data: user } = await supabase.auth.getUser(); const email = user.user?.email ?? ""; const isAdmin = email === "uuxz272@gmail.com" || userId === "3494f40c-adb0-4a3c-b101-27bd69a5b999"; if (isAdmin) return { ok: true, count: 0, cap: UNLIMITED_LIMIT };
  // Paid subscriptions are governed by subscriptions.generations_used. The legacy log RPC must never block a paid user.
  if (plan !== "free") return { ok: true, count: 0, cap: dailyLimitForPlan(plan) };
  const { data, error } = await (supabase.rpc as any)("count_generations_today", { _user_id: userId });
  const count = typeof data === "number" ? data : Number(data ?? 0);
  if (error) return { ok: true, count: 0, cap: FREE_GENERATION_LOG_CAP };
  return { ok: count < FREE_GENERATION_LOG_CAP, count, cap: FREE_GENERATION_LOG_CAP };
}

export async function logGeneration(supabase: SupabaseClient, userId: string, mode: string): Promise<void> {
  const { data: user } = await supabase.auth.getUser(); const email = user.user?.email ?? ""; const isAdmin = email === "uuxz272@gmail.com" || userId === "3494f40c-adb0-4a3c-b101-27bd69a5b999"; if (isAdmin) return;
  const { error } = await supabase.from("ai_generation_log" as never).insert({ user_id: userId, mode } as never); if (error) console.error("ai_generation_log insert failed", error);
}

export async function updateProfile(supabase: SupabaseClient, userId: string, teacherName: string, school: string): Promise<void> { await supabase.from("profiles").update({ teacher_name: teacherName, school }).eq("id", userId); }
