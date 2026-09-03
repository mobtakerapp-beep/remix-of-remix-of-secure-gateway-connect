/**
 * Single source of truth for AI model names.
 *
 * The default Gemini model should track a currently supported production model.
 * The `*_MODEL` secrets still allow overriding without a code change.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.7-flash";
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

/** REST endpoint for a direct (non-OpenAI-compatible) Gemini generateContent call. */
export function geminiGenerateUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/** OpenAI-compatible base URL for Gemini. */
export const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";
