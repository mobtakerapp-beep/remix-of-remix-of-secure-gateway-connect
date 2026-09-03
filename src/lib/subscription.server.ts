import type { Database } from "@/integrations/supabase/types";

type SupabaseClient = ReturnType<
  typeof import("@supabase/supabase-js").createClient<Database>
>;

export type SubscriptionStatus = {
  plan: "free" | "monthly" | "yearly";
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

const FREE_TOTAL_LIMIT = 1; // المجاني: محاولة واحدة فقط مدى الحياة
const PAID_DAILY_LIMIT = 3; // المشترك: 3 دروس يوميًا
const UNLIMITED_LIMIT = 999999; // بلا حدود للأدمن

/** Hard cap backed by ai_generation_log (abuse protection). */
const FREE_GENERATION_LOG_CAP = 1;
const PAID_GENERATION_LOG_CAP = 3;

function isSameDay(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export async function getSubscriptionStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<SubscriptionStatus> {
  let [subResult, profileResult, userResult] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.auth.getUser(),
  ]);

  if (!subResult.data || !profileResult.data) {
    await supabase.rpc("bootstrap_account", { _user_id: userId });
    [subResult, profileResult] = await Promise.all([
      supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    ]);
  }

  const sub = subResult.data;
  const profile = profileResult.data;
  const email = userResult.data?.user?.email ?? "";

  // 👈 التحقق من حساب الأدمن - بلا حدود على المحاولات
  const isAdmin = 
    email === "uuxz272@gmail.com" || 
    userId === "3494f40c-adb0-4a3c-b101-27bd69a5b999";

  const now = new Date();
  let plan: "free" | "monthly" | "yearly" = "free";
  let status: SubscriptionStatus["status"] = "active";
  let generationsUsed = 0;
  let generationsLimit = isAdmin ? UNLIMITED_LIMIT : FREE_TOTAL_LIMIT;
  let resetAt = now;

  if (sub) {
    plan = sub.plan as "free" | "monthly" | "yearly";
    status = sub.status as SubscriptionStatus["status"];
    generationsUsed = sub.generations_used ?? 0;
    resetAt = new Date(sub.reset_at ?? now.toISOString());

    if (isAdmin) {
      // الأدمن: بلا حدود دائمًا
      plan = "yearly";
      status = "active";
      generationsLimit = UNLIMITED_LIMIT;
    } else {
      if (plan !== "free" && sub.expires_at) {
        // Still active through the end of the final day.
        const expiry = new Date(sub.expires_at);
        expiry.setHours(23, 59, 59, 999);
        if (expiry < now) {
          status = "expired";
          plan = "free";
          generationsLimit = FREE_TOTAL_LIMIT;
        } else {
          generationsLimit = PAID_DAILY_LIMIT;
        }
      } else if (plan === "free") {
        generationsLimit = FREE_TOTAL_LIMIT;
      } else {
        generationsLimit = PAID_DAILY_LIMIT;
      }
    }

    // المجاني لا يُصفَّر يوميًا: محاولة واحدة فقط مدى الحياة
    if (plan !== "free" && !isSameDay(resetAt, now)) {
      generationsUsed = 0;
      await supabase
        .from("subscriptions")
        .update({ generations_used: 0, reset_at: now.toISOString() })
        .eq("user_id", userId);
    }
  }

  const canGenerate = isAdmin ? true : generationsUsed < generationsLimit;

  // Days left on the paid subscription (rounded up, never negative).
  const expiresAt = plan === "free" ? null : (sub?.expires_at ?? null);
  const daysRemaining = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86400000))
    : null;

  return {
    plan,
    status,
    generationsUsed,
    generationsLimit,
    canGenerate,
    teacherName: profile?.teacher_name ?? "",
    school: profile?.school ?? "",
    email,
    remainingToday: isAdmin ? UNLIMITED_LIMIT : Math.max(0, generationsLimit - generationsUsed),
    expiresAt,
    daysRemaining,
  };
}

export async function incrementGenerationUsage(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email ?? "";

  // 👈 الحماية: إذا كنت أدمن، ما تزيد العداد ولا تسجل أي استهلاك
  const isAdmin = 
    email === "uuxz272@gmail.com" || 
    userId === "3494f40c-adb0-4a3c-b101-27bd69a5b999";

  if (isAdmin) {
    return; // اخرج فوراً وما تسجلش أي استهلاك
  }

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!sub) return;

  const now = new Date();
  const resetAt = new Date(sub.reset_at ?? now.toISOString());
  const shouldReset = sub.plan !== "free" && !isSameDay(resetAt, now);

  await supabase
    .from("subscriptions")
    .update({
      generations_used: shouldReset ? 1 : (sub.generations_used ?? 0) + 1,
      reset_at: shouldReset ? now.toISOString() : sub.reset_at,
    })
    .eq("user_id", userId);
}

export async function checkGenerationLogCap(
  supabase: SupabaseClient,
  userId: string,
  plan: "free" | "monthly" | "yearly",
): Promise<{ ok: boolean; count: number; cap: number }> {
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email ?? "";

  // الأدمن: لا يوجد حد أقصى للقيود
  const isAdmin = 
    email === "uuxz272@gmail.com" || 
    userId === "3494f40c-adb0-4a3c-b101-27bd69a5b999";

  if (isAdmin) {
    return { ok: true, count: 0, cap: UNLIMITED_LIMIT };
  }

  const { data, error } = await (supabase.rpc as any)("count_generations_today", {
    _user_id: userId,
  });
  const count = typeof data === "number" ? data : Number(data ?? 0);
  if (error) {
    // If the RPC fails open, we still allow generation but surface it in logs.
    console.error("count_generations_today failed", error);
    return { ok: true, count: 0, cap: plan === "free" ? FREE_GENERATION_LOG_CAP : PAID_GENERATION_LOG_CAP };
  }
  const cap = plan === "free" ? FREE_GENERATION_LOG_CAP : PAID_GENERATION_LOG_CAP;
  return { ok: (count ?? 0) < cap, count: count ?? 0, cap };
}

export async function logGeneration(
  supabase: SupabaseClient,
  userId: string,
  mode: string,
): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email ?? "";

  // الأدمن: لا تسجل الاستخدام
  const isAdmin = 
    email === "uuxz272@gmail.com" || 
    userId === "3494f40c-adb0-4a3c-b101-27bd69a5b999";

  if (isAdmin) {
    return; // لا تسجل أي شيء للأدمن
  }

  const { error } = await supabase.from("ai_generation_log" as never).insert({
    user_id: userId,
    mode,
  } as never);
  if (error) console.error("ai_generation_log insert failed", error);
}

export async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  teacherName: string,
  school: string,
): Promise<void> {
  await supabase
    .from("profiles")
    .update({ teacher_name: teacherName, school })
    .eq("id", userId);
}
