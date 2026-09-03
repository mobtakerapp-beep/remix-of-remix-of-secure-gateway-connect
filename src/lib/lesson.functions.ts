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
  /** data URL, e.g. data:application/pdf;base64,... */
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

    const { buildLessonPackage, resolveAiConfigs } = await import("./lesson.server");
    const providers = resolveAiConfigs();

    let result: Awaited<ReturnType<typeof buildLessonPackage>>;
    if (data.mode === "youtube") {
      const url = data.youtubeUrl ?? "";

      // YouTube is handled by the robust transcript path only.
      // We deliberately do NOT fall back to the old googlevideo audio
      // downloader, which is what produced the misleading audio error.
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
