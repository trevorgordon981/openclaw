import type { OpenClawConfig } from "./types.js";

/**
 * Configuration Validation Module
 *
 * Validates critical configuration settings at startup to prevent runtime failures.
 * Provides fast-fail with clear error messages for invalid configurations.
 */

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate port number is within valid range
 */
function validatePort(port: number, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!Number.isInteger(port)) {
    errors.push({
      path,
      message: `Port must be an integer, got: ${port}`,
    });
    return errors;
  }

  if (port < 0 || port > 65535) {
    errors.push({
      path,
      message: `Port must be between 0 and 65535, got: ${port}`,
    });
    return errors;
  }

  if (port < 1024) {
    errors.push({
      path,
      message: `Port ${port} requires elevated privileges (< 1024)`,
    });
  }

  return errors;
}

/**
 * Validate timeout value is positive
 */
function validateTimeout(value: number, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof value !== "number" || value <= 0) {
    errors.push({
      path,
      message: `Timeout must be a positive number, got: ${value}`,
    });
  }

  return errors;
}

/**
 * Validate that API key is present (not empty or whitespace)
 */
function validateApiKey(value: unknown, path: string, required = false): ValidationError[] {
  const errors: ValidationError[] = [];

  if (required && !value) {
    errors.push({
      path,
      message: "API key is required but not provided",
    });
    return errors;
  }

  if (value && typeof value === "string") {
    if (value.trim() === "") {
      errors.push({
        path,
        message: "API key cannot be empty or whitespace",
      });
    }
  }

  return errors;
}

/**
 * Validate model configuration (provider/model pair is valid)
 */
function validateModelConfig(
  provider: string | undefined,
  model: string | undefined,
  path: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Only validate if both are provided
  if (!provider && !model) {
    return errors;
  }

  if (!provider && model) {
    errors.push({
      path: `${path}.provider`,
      message: `Provider is required when model is specified`,
    });
  }

  if (provider && !model) {
    errors.push({
      path: `${path}.model`,
      message: `Model is required when provider is specified`,
    });
  }

  // Validate provider format (simple check for alphanumeric and hyphens)
  if (provider && !/^[a-zA-Z0-9-_]+$/.test(provider)) {
    errors.push({
      path: `${path}.provider`,
      message: `Invalid provider format: "${provider}". Must contain only alphanumeric characters, hyphens, or underscores`,
    });
  }

  // Validate model format
  if (model && !/^[a-zA-Z0-9-_./]+$/.test(model)) {
    errors.push({
      path: `${path}.model`,
      message: `Invalid model format: "${model}". Must contain only alphanumeric characters, hyphens, underscores, dots, or slashes`,
    });
  }

  return errors;
}

/**
 * Validate Slack configuration
 */
function validateSlackConfig(slack: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!slack || typeof slack !== "object") {
    return errors;
  }

  const slackConfig = slack as Record<string, unknown>;

  // If using default token, validate it
  if (slackConfig.defaultBotToken) {
    errors.push(...validateApiKey(slackConfig.defaultBotToken, `${path}.defaultBotToken`, true));
  }

  // Validate per-account tokens if present
  const accounts = slackConfig.accounts as Record<string, unknown> | undefined;
  if (accounts && typeof accounts === "object") {
    for (const [accountId, account] of Object.entries(accounts)) {
      if (account && typeof account === "object") {
        const botToken = (account as Record<string, unknown>).botToken;
        if (botToken) {
          errors.push(...validateApiKey(botToken, `${path}.accounts.${accountId}.botToken`, true));
        }
      }
    }
  }

  return errors;
}

/**
 * Validate Discord configuration
 */
function validateDiscordConfig(discord: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!discord || typeof discord !== "object") {
    return errors;
  }

  const discordConfig = discord as Record<string, unknown>;

  if (discordConfig.botToken) {
    errors.push(...validateApiKey(discordConfig.botToken, `${path}.botToken`, true));
  }

  return errors;
}

/**
 * Validate OpenAI configuration
 */
function validateOpenAiConfig(openai: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!openai || typeof openai !== "object") {
    return errors;
  }

  const openaiConfig = openai as Record<string, unknown>;

  if (openaiConfig.apiKey) {
    errors.push(...validateApiKey(openaiConfig.apiKey, `${path}.apiKey`, true));
  }

  return errors;
}

/**
 * Validate gateway configuration
 */
function validateGatewayConfig(gateway: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!gateway || typeof gateway !== "object") {
    return errors;
  }

  const gatewayConfig = gateway as Record<string, unknown>;

  // Validate port if specified
  if (typeof gatewayConfig.port === "number") {
    errors.push(...validatePort(gatewayConfig.port, `${path}.port`));
  }

  // Validate timeouts if specified
  if (typeof gatewayConfig.readTimeout === "number") {
    errors.push(...validateTimeout(gatewayConfig.readTimeout, `${path}.readTimeout`));
  }

  if (typeof gatewayConfig.writeTimeout === "number") {
    errors.push(...validateTimeout(gatewayConfig.writeTimeout, `${path}.writeTimeout`));
  }

  return errors;
}

/**
 * Validate agents/models configuration
 */
function validateAgentsConfig(agents: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!agents || typeof agents !== "object") {
    return errors;
  }

  const agentsConfig = agents as Record<string, unknown>;

  // Validate defaults.provider and defaults.model
  const defaults = agentsConfig.defaults as Record<string, unknown> | undefined;
  if (defaults && typeof defaults === "object") {
    const provider = defaults.provider as string | undefined;
    const model = defaults.model;
    // Only validate if model is a string (not an object with { primary, ... })
    if (typeof model === "string") {
      errors.push(...validateModelConfig(provider, model, `${path}.defaults`));
    }
  }

  return errors;
}

/**
 * Validate the entire configuration
 */
export function validateConfig(config: OpenClawConfig): ValidationResult {
  const errors: ValidationError[] = [];

  if (!config) {
    return {
      valid: false,
      errors: [{ path: "<root>", message: "Configuration is empty or missing" }],
    };
  }

  // Validate channel configurations
  if (config.channels && typeof config.channels === "object") {
    const channelsConfig = config.channels as Record<string, unknown>;

    if (channelsConfig.slack) {
      errors.push(...validateSlackConfig(channelsConfig.slack, "channels.slack"));
    }

    if (channelsConfig.discord) {
      errors.push(...validateDiscordConfig(channelsConfig.discord, "channels.discord"));
    }
  }

  // Validate providers configuration
  if (config.providers && typeof config.providers === "object") {
    const providersConfig = config.providers as Record<string, unknown>;

    if (providersConfig.openai) {
      errors.push(...validateOpenAiConfig(providersConfig.openai, "providers.openai"));
    }
  }

  // Validate gateway configuration
  if (config.gateway) {
    errors.push(...validateGatewayConfig(config.gateway, "gateway"));
  }

  // Validate agents configuration
  if (config.agents) {
    errors.push(...validateAgentsConfig(config.agents, "agents"));
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate and throw if config is invalid
 */
export function validateConfigOrThrow(config: OpenClawConfig): void {
  const result = validateConfig(config);

  if (!result.valid) {
    const errorMessages = result.errors.map((err) => `  ${err.path}: ${err.message}`).join("\n");

    throw new Error(
      `Invalid configuration detected at startup:\n${errorMessages}\n\n` +
        `Please fix the configuration and restart the gateway.`,
    );
  }
}

/**
 * Validate config object
 * Returns an object with { ok: boolean, issues, warnings, config }
 */
export function validateConfigObject(config: OpenClawConfig): {
  ok: boolean;
  issues: ValidationError[];
  warnings: ValidationError[];
  config: OpenClawConfig;
} {
  const result = validateConfig(config);
  return {
    ok: result.valid,
    issues: result.errors,
    warnings: [],
    config,
  };
}

/**
 * Validate config object with plugin support
 * Returns an object with { ok: boolean, issues, warnings, config }
 */
export function validateConfigObjectWithPlugins(config: OpenClawConfig): {
  ok: boolean;
  issues: ValidationError[];
  warnings: ValidationError[];
  config: OpenClawConfig;
} {
  const result = validateConfig(config);
  return {
    ok: result.valid,
    issues: result.errors,
    warnings: [],
    config,
  };
}
