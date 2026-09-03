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
  numerals: z.enum(["auto", "ar", "en"]).default("auto"),
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

async function getYoutubeDurationSeconds(videoId: string): Promise<number | null> {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
    });
    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/"lengthSeconds":"(\d+)"/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
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

    // Free/trial: text + image only. Standard: PDF up to 2 pages. Premium: PDF up to 3 pages + YouTube up to 2 minutes.
    const isPremium = status.plan === "yearly" || (status.plan as string) === "premium";
    const isPaid = status.plan !== "free";

    if (data.mode === "youtube") {
      if (!isPremium) throw new Error("youtube_premium_only");
      const url = data.youtubeUrl ?? "";
      const { parseYoutubeId } = await import("./youtube-url");
      const videoId = parseYoutubeId(url);
      if (!videoId) throw new Error("youtube_invalid_url");
      const duration = await getYoutubeDurationSeconds(videoId);
      if (duration !== null && duration > 120) throw new Error("youtube_too_long");
      if (duration === null) throw new Error("youtube_duration_unavailable");
    }

    if (data.mode === "pdf") {
      const maxPages = isPremium ? 3 : isPaid ? 2 : 0;
      if (maxPages === 0) throw new Error("pdf_premium_only");
      const pages = data.fileData ? countPdfPages(data.fileData) : null;
      if (pages === null) throw new Error("pdf_page_count_unavailable");
      if (pages > maxPages) throw new Error("pdf_too_many_pages");
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
