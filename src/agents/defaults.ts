// Defaults for agent metadata when upstream does not supply them.
// Model id uses pi-ai's built-in Anthropic catalog.
// Using Claude Haiku for maximum cost efficiency ($0.80/$4 input/output per 1M tokens).
export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-haiku-4-5";
// Context window: Claude Haiku 4.5 supports 200K tokens.
export const DEFAULT_CONTEXT_TOKENS = 200_000;
