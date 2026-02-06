/**
 * Runtime Tool Definition
 *
 * Provides agent interface for session-scoped runtime operations.
 * Agents can use this tool to maintain state across multiple commands.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import {
  globalRuntimeManager,
  type RuntimeCommand,
  type RuntimeOutput,
  type RuntimeState,
} from "../runtime-sessions/runtime-manager.js";

/**
 * Action types for the runtime tool
 */
type RuntimeAction = "exec" | "eval" | "state" | "reset" | "history";

interface RuntimeToolInput {
  action: RuntimeAction;
  command?: string;
  language?: "bash" | "python" | "node";
  limit?: number;
}

interface RuntimeToolOutput {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
  state?: RuntimeState;
  history?: Array<{
    timestamp: number;
    command: string;
    language: string;
    duration: number;
  }>;
}

/**
 * Create the runtime tool for agents
 */
export function createRuntimeTool(
  workspaceId: string,
  agentSessionKey?: string
): AgentTool {
  const baseWorkspaceId = workspaceId || "default";

  const runtimeTool: AgentTool = {
    name: "runtime",
    description:
      "Session-scoped runtime for persistent bash/python environments. Variables and imports persist across calls. Supports: exec (run command), eval (evaluate code), state (inspect env/imports), reset (clear session), history (show recent commands).",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["exec", "eval", "state", "reset", "history"],
          description:
            "Action to perform: exec (run command), eval (evaluate code), state (show env/imports), reset (clear all), history (list commands)",
        },
        command: {
          type: "string",
          description:
            "Command or code to execute (required for exec/eval). For exec: bash command. For eval: python code.",
        },
        language: {
          type: "string",
          enum: ["bash", "python", "node"],
          description:
            'Language/runtime to use. Default: bash for exec, python for eval. (node not yet supported)',
        },
        limit: {
          type: "number",
          description: "Limit for history action (number of entries to show). Default: 20",
        },
      },
      required: ["action"],
    },
    call: async (input: unknown): Promise<AgentToolResult> => {
      try {
        const toolInput = input as RuntimeToolInput;
        const action = toolInput.action?.toLowerCase();

        if (!action || !["exec", "eval", "state", "reset", "history"].includes(action)) {
          return {
            type: "tool_result",
            content: JSON.stringify({
              success: false,
              error: `Invalid action: ${action}. Must be one of: exec, eval, state, reset, history`,
            } as RuntimeToolOutput),
          };
        }

        // Get or create session for this workspace
        const session = globalRuntimeManager.getOrCreateSession(baseWorkspaceId);

        // Handle different actions
        switch (action) {
          case "exec": {
            if (!toolInput.command) {
              return {
                type: "tool_result",
                content: JSON.stringify({
                  success: false,
                  error: "command is required for exec action",
                } as RuntimeToolOutput),
              };
            }

            const cmd: RuntimeCommand = {
              command: toolInput.command,
              language: toolInput.language || "bash",
            };

            const output: RuntimeOutput = await session.exec(cmd);

            return {
              type: "tool_result",
              content: JSON.stringify({
                success: !output.error,
                stdout: output.stdout,
                stderr: output.stderr,
                exitCode: output.exitCode,
                error: output.error,
              } as RuntimeToolOutput),
            };
          }

          case "eval": {
            if (!toolInput.command) {
              return {
                type: "tool_result",
                content: JSON.stringify({
                  success: false,
                  error: "command is required for eval action",
                } as RuntimeToolOutput),
              };
            }

            const output = await session.eval(
              toolInput.command,
              toolInput.language || "python"
            );

            return {
              type: "tool_result",
              content: JSON.stringify({
                success: !output.error,
                stdout: output.stdout,
                stderr: output.stderr,
                error: output.error,
              } as RuntimeToolOutput),
            };
          }

          case "state": {
            const state = await session.state();
            return {
              type: "tool_result",
              content: JSON.stringify({
                success: true,
                state,
              } as RuntimeToolOutput),
            };
          }

          case "reset": {
            await session.reset();
            return {
              type: "tool_result",
              content: JSON.stringify({
                success: true,
                stdout: "Session reset successfully",
              } as RuntimeToolOutput),
            };
          }

          case "history": {
            const limit = toolInput.limit || 20;
            const history = session.getHistory(limit);

            return {
              type: "tool_result",
              content: JSON.stringify({
                success: true,
                history: history.map((entry) => ({
                  timestamp: entry.timestamp,
                  command: entry.command,
                  language: entry.language,
                  duration: entry.duration,
                })),
              } as RuntimeToolOutput),
            };
          }

          default:
            return {
              type: "tool_result",
              content: JSON.stringify({
                success: false,
                error: `Unknown action: ${action}`,
              } as RuntimeToolOutput),
            };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          type: "tool_result",
          content: JSON.stringify({
            success: false,
            error: errorMessage,
          } as RuntimeToolOutput),
        };
      }
    },
  };

  return runtimeTool;
}

/**
 * Default runtime tool (uses "default" workspace)
 */
export const runtimeTool: AgentTool = createRuntimeTool("default");
