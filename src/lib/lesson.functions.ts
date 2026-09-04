import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAppAuth } from "@/lib/app-auth-middleware";
import {
  checkGenerationLogCap,
  getSubscriptionStatus,
  logGeneration,
} from "./subscription.server";

const InputSchema = z.object({
  mode: z.enum(["text", "pdf", "image", "youtube"]),
  text: z.string().optional(),
  youtubeUrl: z.string().optional(),
  fileName: z.string().optional(),
  fileData: z.string().optional(),
  mediaType: z.string().optional(),
  counts: z.object({
    mcq: z.number().int().min(1).max(20),
    trueFalse: z.number().int().min(1).max(20),
    flashcards: z.number().int().min(1).max(20),
  }),
  language: z.enum(["auto", "ar", "en"]).default("auto"),
  numerals: z.enum(["auto", "ar"]).or(z.literal("en")).default("auto"),
  grade: z.number().int().min(1).max(12).default(5),
});

function countPdfPages(dataUrl: string): number | null {
  try {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    const binary = atob(dataUrl.slice(comma + 1));
    const matches = binary.match(/\/Type\s*\/Page(?:\s|\/|>)/g);
    return matches?.length ?? null;
  } catch {
    return null;
  }
}

async function countGiftGenerationsToday(userId: string): Promise<number> {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase-admin.server");
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const { count, error } = await supabaseAdmin
      .from("ai_generation_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("mode", ["text", "image"])
      .gte("created_at", start.toISOString());
    if (error) {
      console.error("countGiftGenerationsToday failed", error);
      return 0;
    }
    return count ?? 0;
  } catch (error) {
    console.error("countGiftGenerationsToday failed", error);
    return 0;
  }
}

async function countPremiumVideosToday(userId: string): Promise<number> {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase-admin.server");
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const { count, error } = await supabaseAdmin
      .from("ai_generation_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("mode", "youtube")
      .gte("created_at", start.toISOString());
    if (error) {
      console.error("countPremiumVideosToday failed", error);
      return 0;
    }
    return count ?? 0;
  } catch (error) {
    console.error("countPremiumVideosToday failed", error);
    return 0;
  }
}

export const generateLessonPackage = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const status = await getSubscriptionStatus(context.supabase, context.userId);
    if (!status.canGenerate) {
      throw new Error(status.plan === "free" ? "limit_reached" : "subscription_expired");
    }

    const { ok: withinCap } = await checkGenerationLogCap(
      context.supabase,
      context.userId,
      status.plan,
    );
    if (!withinCap) throw new Error("daily_log_cap_reached");

    const isPremium = status.plan === "premium";
    const isPaid = status.plan !== "free";
    const isOwner = status.generationsLimit >= 999999;

    // Gift codes are marked in activation_codes.note with the [GIFT] prefix.
    // Gifts allow exactly ONE generation per day, and only text OR image.
    let isGift = false;
    if (!isOwner) {
      const { data: redemption } = await context.supabase
        .from("code_redemptions")
        .select("activation_codes(note)")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const activationCode = Array.isArray(redemption?.activation_codes)
        ? redemption?.activation_codes[0]
        : redemption?.activation_codes;
      const note = (activationCode as { note?: string | null } | null)?.note ?? "";
      isGift = note.trim().toUpperCase().startsWith("[GIFT]");
    }

    if (isGift && data.mode !== "text" && data.mode !== "image") {
      throw new Error("أكواد الهدايا متاحة للنص أو الصورة فقط");
    }

    if (isGift) {
      const giftGenerationsToday = await countGiftGenerationsToday(context.userId);
      if (giftGenerationsToday >= 1) {
        throw new Error("gift_daily_limit");
      }
    }

    if (data.mode === "pdf") {
      if (isGift) throw new Error("أكواد الهدايا لا تشمل ملفات PDF");
      const maxPages = isPremium ? 3 : isPaid ? 2 : 0;
      if (maxPages === 0) throw new Error("ملف PDF متاح في الاشتراك العادي أو المميز فقط");
      const pages = data.fileData ? countPdfPages(data.fileData) : null;
      if (pages === null) throw new Error("تعذر قراءة عدد صفحات ملف PDF");
      if (pages > maxPages) throw new Error(`الحد الأقصى لملف PDF في خطتك هو ${maxPages} صفحات`);
    }

    if (data.mode === "youtube") {
      if (isGift) throw new Error("أكواد الهدايا لا تشمل الفيديو");
      if (!isPremium) throw new Error("الفيديو متاح في الاشتراك المميز فقط");
      if (!isOwner) {
        const videosToday = await countPremiumVideosToday(context.userId);
        if (videosToday >= 1) {
          throw new Error("premium_video_daily_limit");
        }
      }
      const url = data.youtubeUrl ?? "";
      const { parseYoutubeId } = await import("./youtube-url");
      const videoId = parseYoutubeId(url);
      if (!videoId) throw new Error("youtube_invalid_url");
      const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
      });
      if (!response.ok) throw new Error("تعذر التحقق من مدة الفيديو، حاولي مرة أخرى");
      const html = await response.text();
      const match = html.match(/"lengthSeconds":"(\d+)"/);
      const duration = match ? Number(match[1]) : null;
      if (duration === null) throw new Error("تعذر التحقق من مدة الفيديو، حاولي مرة أخرى");
      if (duration > 120) throw new Error("الفيديو يجب ألا يتجاوز دقيقتين");
    }

    const { buildLessonPackage, resolveAiConfigs } = await import("./lesson.server");
    const providers = resolveAiConfigs();

    let result: Awaited<ReturnType<typeof buildLessonPackage>>;
    if (data.mode === "youtube") {
      const url = data.youtubeUrl ?? "";
      const robust = await import("./youtube-robust.server");
      const transcript = await robust.fetchYoutubeTranscriptRobust(url);

      result = await buildLessonPackage(
        {
          ...data,
          mode: "text",
          text: `${transcript.title}\n\n${transcript.text}`,
          youtubeUrl: undefined,
        },
        providers,
      );
    } else {
      const { youtubeUrl: _unused, ...payload } = data;
      result = await buildLessonPackage(payload as never, providers);
    }

    await Promise.all([
      logGeneration(context.supabase, context.userId, data.mode),
      import("./subscription.server").then(({ incrementGenerationUsage }) =>
        incrementGenerationUsage(context.supabase, context.userId),
      ),
    ]);

    return result;
  });
