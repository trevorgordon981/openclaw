// Defaults for agent metadata when upstream does not supply them.
// Model id uses pi-ai's built-in Anthropic catalog.
// Using Claude Sonnet for balance of capability and cost ($3/$15 input/output per 1M tokens).
export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-sonnet-4-5";
// Context window: Claude Sonnet 4.5 supports 200K tokens.
export const DEFAULT_CONTEXT_TOKENS = 200_000;
