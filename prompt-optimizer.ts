/**
 * prompt-optimizer.ts
 * Token efficiency layer for OpenClaw agent communication
 *
 * Responsibilities:
 * - Deduplicate system prompts across agent instances
 * - Minify tool schemas (remove redundant descriptions)
 * - Template common section patterns
 * - Compress message batches before LLM submission
 *
 * Usage:
 * - Import once, use globally (singleton pattern)
 * - Integrate into pi-embedded-runner.ts for system prompt building
 * - Integrate into compaction.ts for message batch compression
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";

// ============================================================================
// Core Types
// ============================================================================

export type PromptMode = "full" | "minimal" | "none";

export interface PromptSection {
  id: string;
  title: string;
  content: string[];
  mode: "all" | "full-only" | "subagent-only";
  tokens: number;
}

export interface ToolSchemaMinified {
  name: string;
  description?: string; // Optional in minified mode
  inputSchema?: Record<string, unknown>; // Minified (descriptions stripped)
  displayHints?: {
    emoji: string;
    title: string;
    detailKeys: string[];
  };
}

export interface MessageBatch {
  messages: AgentMessage[];
  tokenCount: number;
  compressible: boolean;
  compressionRatio?: number;
}

export interface CompressedMessageBatch {
  messages: AgentMessage[];
  originalTokens: number;
  compressedTokens: number;
  compression: number; // percentage saved
  strategy: string; // e.g., "dedup" | "summarize" | "prune"
}

// ============================================================================
// Singleton: Core Tool Summaries (deduplicated)
// ============================================================================

const CORE_TOOL_SUMMARIES_SINGLETON: Map<string, string> = new Map([
  ["read", "Read file contents"],
  ["write", "Create or overwrite files"],
  ["edit", "Make precise edits to files"],
  ["apply_patch", "Apply multi-file patches"],
  ["grep", "Search file contents for patterns"],
  ["find", "Find files by glob pattern"],
  ["ls", "List directory contents"],
  ["exec", "Run shell commands (pty available for TTY-required CLIs)"],
  ["process", "Manage background exec sessions"],
  ["web_search", "Search the web (Brave API)"],
  ["web_fetch", "Fetch and extract readable content from a URL"],
  ["browser", "Control web browser"],
  ["canvas", "Present/eval/snapshot the Canvas"],
  ["nodes", "List/describe/notify/camera/screen on paired nodes"],
  ["cron", "Manage cron jobs and wake events"],
  ["message", "Send messages and channel actions"],
  ["gateway", "Restart, apply config, or run updates"],
  ["agents_list", "List agent ids allowed for sessions_spawn"],
  ["sessions_list", "List other sessions (incl. sub-agents)"],
  ["sessions_history", "Fetch history for another session/sub-agent"],
  ["sessions_send", "Send a message to another session/sub-agent"],
  ["sessions_spawn", "Spawn a sub-agent session"],
  ["session_status", "Show session status card (usage + time)"],
  ["image", "Analyze an image with the configured image model"],
  ["memory_search", "Search memory (MEMORY.md + memory/*.md)"],
  ["memory_get", "Fetch specific lines from memory files"],
]);

export function getCoreToolSummary(toolName: string): string | undefined {
  return CORE_TOOL_SUMMARIES_SINGLETON.get(toolName);
}

// ============================================================================
// Prompt Section Deduplication
// ============================================================================

/**
 * Deduplicates system prompt sections by mode.
 * Returns only sections relevant to the given mode, stripping redundant content.
 */
export function deduplicatePromptSections(mode: PromptMode): PromptSection[] {
  const sections: PromptSection[] = [];

  // All modes get these
  sections.push({
    id: "identity",
    title: "Identity",
    content: ["You are an AI assistant."],
    mode: "all",
    tokens: 10,
  });

  if (mode === "full") {
    sections.push(
      {
        id: "skills",
        title: "Skills",
        content: [
          "Before replying: scan available_skills entries.",
          "If exactly one skill clearly applies: read its SKILL.md, then follow it.",
        ],
        mode: "full-only",
        tokens: 40,
      },
      {
        id: "memory",
        title: "Memory Recall",
        content: ["Before answering about prior work: run memory_search."],
        mode: "full-only",
        tokens: 30,
      },
      {
        id: "userIdentity",
        title: "User Identity",
        content: ["[User context injected here]"],
        mode: "full-only",
        tokens: 20,
      },
      {
        id: "time",
        title: "Current Date & Time",
        content: ["[Timezone injected here]"],
        mode: "full-only",
        tokens: 15,
      }
    );
  }

  // Both full and minimal
  if (mode === "full" || mode === "minimal") {
    sections.push({
      id: "messaging",
      title: "Messaging",
      content: [
        "Reply in current session → automatically routes to source channel.",
        "Use message tool for proactive sends and channel actions.",
      ],
      mode: "all",
      tokens: 35,
    });
  }

  return sections;
}

// ============================================================================
// Tool Schema Minification
// ============================================================================

/**
 * Minifies a tool schema by stripping verbose descriptions.
 * Preserves required fields; reduces parameter descriptions after first N tools.
 */
export function minifyToolSchema(
  tool: Record<string, unknown>,
  toolIndex: number,
  minifyThreshold: number = 5
): ToolSchemaMinified {
  const name = String(tool.name ?? "unknown");
  const shouldKeepDescriptions = toolIndex < minifyThreshold;

  const minified: ToolSchemaMinified = {
    name,
    displayHints: {
      emoji: "🧩",
      title: name.charAt(0).toUpperCase() + name.slice(1),
      detailKeys: [],
    },
  };

  // Include summary description for first N tools
  if (shouldKeepDescriptions && tool.description) {
    minified.description = String(tool.description);
  }

  // Minify input schema: strip parameter descriptions
  if (tool.inputSchema && typeof tool.inputSchema === "object") {
    const schema = tool.inputSchema as Record<string, unknown>;
    const minifiedSchema: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(schema)) {
      if (key === "properties" && typeof value === "object") {
        const props = value as Record<string, Record<string, unknown>>;
        const minifiedProps: Record<string, unknown> = {};

        for (const [propName, propDef] of Object.entries(props)) {
          // Keep type and required, strip description
          const minifiedProp: Record<string, unknown> = {};
          if (propDef.type) minifiedProp.type = propDef.type;
          if (propDef.enum) minifiedProp.enum = propDef.enum;
          if (propDef.items) minifiedProp.items = propDef.items;

          // Only keep description if minifying is disabled
          if (shouldKeepDescriptions && propDef.description) {
            minifiedProp.description = propDef.description;
          }

          minifiedProps[propName] = minifiedProp;
        }

        minifiedSchema.properties = minifiedProps;
      } else if (key !== "description" || shouldKeepDescriptions) {
        minifiedSchema[key] = value;
      }
    }

    minified.inputSchema = minifiedSchema;
  }

  return minified;
}

/**
 * Minifies an array of tool schemas, applying index-aware minification.
 */
export function minifyToolSchemaArray(
  tools: Record<string, unknown>[],
  minifyThreshold: number = 5
): ToolSchemaMinified[] {
  return tools.map((tool, index) => minifyToolSchema(tool, index, minifyThreshold));
}

// ============================================================================
// Message Batch Compression
// ============================================================================

/**
 * Analyzes a message batch and determines if it's compressible.
 */
export function analyzeMessageBatch(messages: AgentMessage[]): MessageBatch {
  let tokenCount = 0;
  let compressible = false;

  for (const msg of messages) {
    // Simple heuristic: count content length as rough token proxy
    const content =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? JSON.stringify(msg.content)
          : "";

    const roughTokens = Math.ceil(content.length / 4); // avg 4 chars per token
    tokenCount += roughTokens;

    // Flag as compressible if message is verbose
    if (roughTokens > 500) {
      compressible = true;
    }
  }

  return {
    messages,
    tokenCount,
    compressible,
    compressionRatio: compressible ? 0.7 : 1.0, // estimate 30% compression if needed
  };
}

/**
 * Deduplicates repeated content blocks within a message batch.
 * Removes duplicate "Workspace files" sections and context headers.
 */
export function deduplicateMessageBatch(messages: AgentMessage[]): AgentMessage[] {
  const seenBlocks = new Set<string>();
  const deduplicated: AgentMessage[] = [];

  for (const msg of messages) {
    let content = msg.content;
    if (typeof content === "string") {
      // Split on common delimiter patterns
      const blocks = content.split(/^## /m); // markdown section headers
      const filteredBlocks = blocks.filter((block) => {
        const trimmed = block.trim();
        if (seenBlocks.has(trimmed)) {
          return false; // Skip duplicate
        }
        if (trimmed.length > 10) {
          seenBlocks.add(trimmed);
        }
        return true;
      });

      content = filteredBlocks.join("\n## ");
    }

    deduplicated.push({ ...msg, content });
  }

  return deduplicated;
}

/**
 * Prunes excessively verbose tool results.
 */
export function pruneVerboseToolResults(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;

    const pruned = msg.content.map((block) => {
      if (typeof block === "object" && block !== null && "type" in block) {
        const blockObj = block as Record<string, unknown>;
        if (
          blockObj.type === "tool_result" &&
          typeof blockObj.content === "string" &&
          blockObj.content.length > 2000
        ) {
          // Truncate verbose results to summary
          return {
            ...blockObj,
            content: blockObj.content.slice(0, 500) + "\n[... truncated ...]",
          };
        }
      }
      return block;
    });

    return { ...msg, content: pruned };
  });
}

/**
 * Compresses a message batch using multiple strategies.
 */
export function compressMessageBatch(messages: AgentMessage[]): CompressedMessageBatch {
  const analysis = analyzeMessageBatch(messages);

  let compressed = messages;
  let strategy = "none";

  if (analysis.compressible) {
    // Step 1: Deduplication
    const deduped = deduplicateMessageBatch(compressed);
    if (deduped.length < compressed.length) {
      compressed = deduped;
      strategy = "dedup";
    }

    // Step 2: Prune verbose results
    const pruned = pruneVerboseToolResults(compressed);
    compressed = pruned;
    if (strategy === "dedup") {
      strategy = "dedup+prune";
    } else {
      strategy = "prune";
    }
  }

  const compressedAnalysis = analyzeMessageBatch(compressed);
  const ratio = 1 - compressedAnalysis.tokenCount / analysis.tokenCount;

  return {
    messages: compressed,
    originalTokens: analysis.tokenCount,
    compressedTokens: compressedAnalysis.tokenCount,
    compression: Math.round(ratio * 100),
    strategy,
  };
}

// ============================================================================
// Prompt Template System
// ============================================================================

/**
 * Template for a prompt section with substitution placeholders.
 */
export interface PromptTemplate {
  id: string;
  template: string;
  placeholders: string[];
}

const SECTION_TEMPLATES: Record<string, PromptTemplate> = {
  skills: {
    id: "skills",
    template: `## Skills
Before replying: scan <available_skills> entries.
- If exactly one skill clearly applies: read {{skillLocation}}, then follow it.
- If multiple apply: choose the most specific one.
- If none apply: do not read any SKILL.md.
Constraint: never read more than one skill upfront.
{{skillsContent}}`,
    placeholders: ["skillLocation", "skillsContent"],
  },

  memory: {
    id: "memory",
    template: `## Memory Recall
Before answering anything about prior work, decisions, or preferences: run memory_search.
Then use memory_get to pull needed lines.
Citations: include Source: <path#line> when it helps verify snippets.
{{memoryCitationsMode}}`,
    placeholders: ["memoryCitationsMode"],
  },

  messaging: {
    id: "messaging",
    template: `## Messaging
- Reply in current session → automatically routes to source channel.
- Cross-session → use sessions_send(sessionKey, message).
- Never use exec/curl for provider messaging.
{{messageToolHints}}`,
    placeholders: ["messageToolHints"],
  },

  docs: {
    id: "docs",
    template: `## Documentation
OpenClaw docs: {{docsPath}}
When diagnosing issues, run \`openclaw status\` yourself when possible.`,
    placeholders: ["docsPath"],
  },
};

/**
 * Renders a section template with provided values.
 */
export function renderSectionTemplate(
  templateId: string,
  values: Record<string, string>
): string {
  const template = SECTION_TEMPLATES[templateId];
  if (!template) return "";

  let result = template.template;
  for (const placeholder of template.placeholders) {
    const value = values[placeholder] ?? "";
    result = result.replace(`{{${placeholder}}}`, value);
  }

  return result;
}

// ============================================================================
// Exports
// ============================================================================

export const promptOptimizer = {
  // Deduplication
  deduplicatePromptSections,
  getCoreToolSummary,

  // Minification
  minifyToolSchema,
  minifyToolSchemaArray,

  // Message compression
  analyzeMessageBatch,
  deduplicateMessageBatch,
  pruneVerboseToolResults,
  compressMessageBatch,

  // Templating
  renderSectionTemplate,
  SECTION_TEMPLATES,
} as const;

export default promptOptimizer;
