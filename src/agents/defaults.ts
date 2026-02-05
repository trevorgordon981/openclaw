// Defaults for agent metadata when upstream does not supply them.
// Model id uses pi-ai's built-in Google catalog.
// Switched to Gemini 2.0 Flash for cost efficiency ($0.075/$0.30 input/output).
export const DEFAULT_PROVIDER = "google";
export const DEFAULT_MODEL = "gemini-2.0-flash";
// Context window: Gemini 2.0 Flash supports 1M tokens (per Google's documentation).
export const DEFAULT_CONTEXT_TOKENS = 1_000_000;
