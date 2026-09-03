/**
 * Single source of truth for AI model names.
 *
 * The default Gemini model is kept on the lower-risk free-tier model
 * currently used by the project. Runtime secrets can still override the
 * model for each provider when needed.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/** REST endpoint for a direct (non-OpenAI-compatible) Gemini generateContent call. */
export function geminiGenerateUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/** OpenAI-compatible base URL for Gemini. */
export const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";
