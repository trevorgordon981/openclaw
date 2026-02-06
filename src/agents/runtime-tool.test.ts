/**
 * Tests for Runtime Tool
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRuntimeTool } from "./runtime-tool.js";
import { globalRuntimeManager } from "../runtime-sessions/runtime-manager.js";

describe("Runtime Tool", () => {
  let tool: ReturnType<typeof createRuntimeTool>;

  beforeEach(() => {
    tool = createRuntimeTool("test-workspace");
  });

  afterEach(async () => {
    await globalRuntimeManager.terminateAll();
  });

  it("should have correct schema", () => {
    expect(tool.name).toBe("runtime");
    expect(tool.description).toContain("Session-scoped runtime");
    expect(tool.input_schema).toBeDefined();
    expect(tool.input_schema.properties.action).toBeDefined();
  });

  it("should execute bash commands via tool", async () => {
    const result = await tool.call({
      action: "exec",
      command: "echo 'test output'",
      language: "bash",
    });

    const content = JSON.parse(result.content);
    expect(content.success).toBe(true);
    expect(content.stdout).toContain("test output");
  });

  it("should execute Python code via tool", async () => {
    const result = await tool.call({
      action: "exec",
      command: "print('hello')",
      language: "python",
    });

    const content = JSON.parse(result.content);
    expect(content.success).toBe(true);
    expect(content.stdout).toContain("hello");
  });

  it("should persist state across exec calls", async () => {
    // Set a variable
    await tool.call({
      action: "exec",
      command: "VAR='persistent'",
      language: "bash",
    });

    // Use the variable
    const result = await tool.call({
      action: "exec",
      command: "echo $VAR",
      language: "bash",
    });

    const content = JSON.parse(result.content);
    expect(content.stdout).toContain("persistent");
  });

  it("should return state with env_vars", async () => {
    const result = await tool.call({
      action: "state",
    });

    const content = JSON.parse(result.content);
    expect(content.success).toBe(true);
    expect(content.state).toBeDefined();
    expect(content.state.env_vars).toBeDefined();
    expect(content.state.history).toBeDefined();
  });

  it("should reset the session", async () => {
    // Do some work
    await tool.call({
      action: "exec",
      command: "echo test",
      language: "bash",
    });

    // Check history
    const stateBefore = await tool.call({ action: "state" });
    const contentBefore = JSON.parse(stateBefore.content);
    expect(contentBefore.state.history.length).toBeGreaterThan(0);

    // Reset
    await tool.call({ action: "reset" });

    // Check history again
    const stateAfter = await tool.call({ action: "state" });
    const contentAfter = JSON.parse(stateAfter.content);
    expect(contentAfter.state.history.length).toBe(0);
  });

  it("should return command history", async () => {
    // Execute some commands
    await tool.call({
      action: "exec",
      command: "echo 'cmd1'",
      language: "bash",
    });

    await tool.call({
      action: "exec",
      command: "echo 'cmd2'",
      language: "bash",
    });

    // Get history
    const result = await tool.call({
      action: "history",
      limit: 10,
    });

    const content = JSON.parse(result.content);
    expect(content.success).toBe(true);
    expect(Array.isArray(content.history)).toBe(true);
    expect(content.history.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle errors gracefully", async () => {
    const result = await tool.call({
      action: "exec",
      command: "nonexistent_command_xyz",
      language: "bash",
    });

    const content = JSON.parse(result.content);
    expect(content.success).toBe(false);
    expect(content.error).toBeDefined();
  });

  it("should validate required parameters", async () => {
    const result = await tool.call({
      action: "exec",
      // Missing 'command'
    });

    const content = JSON.parse(result.content);
    expect(content.success).toBe(false);
    expect(content.error).toContain("required");
  });

  it("should validate action parameter", async () => {
    const result = await tool.call({
      action: "invalid_action",
    });

    const content = JSON.parse(result.content);
    expect(content.success).toBe(false);
    expect(content.error).toContain("Invalid action");
  });

  it("should eval Python code directly", async () => {
    const result = await tool.call({
      action: "eval",
      command: "x = 10; print(x * 2)",
      language: "python",
    });

    const content = JSON.parse(result.content);
    expect(content.success).toBe(true);
    expect(content.stdout).toContain("20");
  });

  it("should track Python imports in state", async () => {
    // Import a module
    await tool.call({
      action: "exec",
      command: "import json",
      language: "python",
    });

    // Get state
    const result = await tool.call({
      action: "state",
    });

    const content = JSON.parse(result.content);
    expect(content.state.imports).toContain("json");
  });
});
