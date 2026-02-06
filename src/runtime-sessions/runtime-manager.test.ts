/**
 * Tests for Runtime Session Manager
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RuntimeSession, globalRuntimeManager } from "./runtime-manager.js";

describe("RuntimeSession", () => {
  let session: RuntimeSession;

  beforeEach(() => {
    session = new RuntimeSession({ workspaceId: "test-workspace" });
  });

  afterEach(async () => {
    if (session) {
      await session.terminate();
    }
  });

  it("should execute bash commands", async () => {
    const result = await session.exec({
      command: "echo 'hello world'",
      language: "bash",
    });

    expect(result.stdout).toContain("hello world");
    expect(result.error).toBeUndefined();
  });

  it("should persist bash variables across calls", async () => {
    // Set a variable
    await session.exec({
      command: "VAR='hello'",
      language: "bash",
    });

    // Use the variable in a second call
    const result = await session.exec({
      command: "echo $VAR",
      language: "bash",
    });

    expect(result.stdout).toContain("hello");
  });

  it("should execute Python code", async () => {
    const result = await session.exec({
      command: 'print("hello from python")',
      language: "python",
    });

    expect(result.stdout).toContain("hello from python");
    expect(result.error).toBeUndefined();
  });

  it("should persist Python variables across calls", async () => {
    // Set a variable
    await session.exec({
      command: "x = 42",
      language: "python",
    });

    // Use the variable
    const result = await session.exec({
      command: "print(x)",
      language: "python",
    });

    expect(result.stdout).toContain("42");
  });

  it("should track command history", async () => {
    await session.exec({ command: "echo test1", language: "bash" });
    await session.exec({ command: "echo test2", language: "bash" });
    await session.exec({ command: "echo test3", language: "bash" });

    const history = session.getHistory(10);
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history[history.length - 1].command).toContain("test3");
  });

  it("should return state with environment variables", async () => {
    await session.exec({
      command: "export TEST_VAR=test_value",
      language: "bash",
    });

    const state = await session.state();
    expect(state).toHaveProperty("env_vars");
    expect(state).toHaveProperty("working_dir");
    expect(state).toHaveProperty("history");
  });

  it("should track Python imports", async () => {
    await session.exec({
      command: "import math",
      language: "python",
    });

    const state = await session.state();
    expect(state.imports).toContain("math");
  });

  it("should reset the session", async () => {
    // Set some state
    await session.exec({
      command: "VAR='test'",
      language: "bash",
    });

    const history1 = session.getHistory();
    expect(history1.length).toBeGreaterThan(0);

    // Reset
    await session.reset();

    const history2 = session.getHistory();
    expect(history2.length).toBe(0);
  });

  it("should report when session is terminated", async () => {
    await session.terminate();

    const result = await session.exec({
      command: "echo test",
      language: "bash",
    }).catch((err) => ({ error: err.message }));

    expect(result).toHaveProperty("error");
  });
});

describe("RuntimeSessionManager", () => {
  afterEach(async () => {
    await globalRuntimeManager.terminateAll();
  });

  it("should create and reuse sessions", () => {
    const session1 = globalRuntimeManager.getOrCreateSession("workspace-1");
    const session2 = globalRuntimeManager.getOrCreateSession("workspace-1");

    expect(session1).toBe(session2);
  });

  it("should isolate sessions by workspace", () => {
    const session1 = globalRuntimeManager.getOrCreateSession("workspace-1");
    const session2 = globalRuntimeManager.getOrCreateSession("workspace-2");

    expect(session1).not.toBe(session2);
  });

  it("should track active sessions", async () => {
    globalRuntimeManager.getOrCreateSession("workspace-1");
    globalRuntimeManager.getOrCreateSession("workspace-2");

    const sessions = globalRuntimeManager.getActiveSessions();
    expect(sessions.size).toBe(2);
  });

  it("should terminate all sessions", async () => {
    globalRuntimeManager.getOrCreateSession("workspace-1");
    globalRuntimeManager.getOrCreateSession("workspace-2");

    expect(globalRuntimeManager.getSessionCount()).toBe(2);

    await globalRuntimeManager.terminateAll();

    expect(globalRuntimeManager.getSessionCount()).toBe(0);
  });
});
