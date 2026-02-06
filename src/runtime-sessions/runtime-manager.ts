/**
 * Runtime Session Manager
 *
 * Manages long-lived shell and Python sessions with state persistence across
 * multiple exec calls. Each workspace gets its own isolated session with automatic
 * timeout and cleanup.
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { ShellSession } from "./shell-session.js";
import type { PythonSession } from "./python-session.js";

export type RuntimeType = "bash" | "python" | "node";

export interface RuntimeCommand {
  command: string;
  language?: RuntimeType;
  timeout?: number;
}

export interface RuntimeOutput {
  stdout: string;
  stderr: string;
  exitCode?: number;
  error?: string;
}

export interface RuntimeState {
  env_vars: Record<string, string>;
  functions: string[];
  imports: string[];
  working_dir: string;
  history: RuntimeHistoryEntry[];
}

export interface RuntimeHistoryEntry {
  timestamp: number;
  command: string;
  language: RuntimeType;
  stdout: string;
  stderr: string;
  exitCode?: number;
  duration: number;
}

export interface SessionConfig {
  workspaceId: string;
  timeoutMs?: number;
  maxHistorySize?: number;
}

/**
 * Manages a single runtime session with lifecycle and state tracking
 */
export class RuntimeSession extends EventEmitter {
  private workspaceId: string;
  private timeoutMs: number;
  private maxHistorySize: number;
  private shellSession: ShellSession | null = null;
  private pythonSession: PythonSession | null = null;
  private history: RuntimeHistoryEntry[] = [];
  private lastActivityTime: number = Date.now();
  private timeoutHandle: NodeJS.Timeout | null = null;
  private isAlive: boolean = true;

  constructor(config: SessionConfig) {
    super();
    this.workspaceId = config.workspaceId;
    this.timeoutMs = config.timeoutMs ?? 30 * 60 * 1000; // 30 minutes default
    this.maxHistorySize = config.maxHistorySize ?? 100;
    this.startTimeoutTracker();
  }

  /**
   * Execute a command in the appropriate runtime
   */
  async exec(cmd: RuntimeCommand): Promise<RuntimeOutput> {
    if (!this.isAlive) {
      throw new Error("Session has been terminated");
    }

    this.updateActivityTime();
    const startTime = Date.now();
    const language = cmd.language ?? "bash";

    try {
      let output: RuntimeOutput;

      if (language === "bash") {
        if (!this.shellSession) {
          const { ShellSession } = await import("./shell-session.js");
          this.shellSession = new ShellSession({ workspaceId: this.workspaceId });
        }
        output = await this.shellSession.execute(cmd.command, cmd.timeout);
      } else if (language === "python") {
        if (!this.pythonSession) {
          const { PythonSession } = await import("./python-session.js");
          this.pythonSession = new PythonSession({ workspaceId: this.workspaceId });
        }
        output = await this.pythonSession.execute(cmd.command, cmd.timeout);
      } else {
        throw new Error(`Unsupported runtime type: ${language}`);
      }

      const duration = Date.now() - startTime;
      this.recordHistory({
        timestamp: Date.now(),
        command: cmd.command,
        language,
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.exitCode,
        duration,
      });

      return output;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.recordHistory({
        timestamp: Date.now(),
        command: cmd.command,
        language,
        stdout: "",
        stderr: errorMessage,
        duration,
      });

      return {
        stdout: "",
        stderr: errorMessage,
        error: errorMessage,
      };
    }
  }

  /**
   * Evaluate Python or JavaScript code inline
   */
  async eval(code: string, language: RuntimeType = "python"): Promise<RuntimeOutput> {
    if (!this.isAlive) {
      throw new Error("Session has been terminated");
    }

    if (language !== "python") {
      return {
        stdout: "",
        stderr: `eval() only supports python; got ${language}`,
        error: `eval() only supports python; got ${language}`,
      };
    }

    return this.exec({ command: code, language, timeout: 30000 });
  }

  /**
   * Get current session state (env vars, imports, etc.)
   */
  async state(): Promise<RuntimeState> {
    if (!this.isAlive) {
      throw new Error("Session has been terminated");
    }

    const state: RuntimeState = {
      env_vars: {},
      functions: [],
      imports: [],
      working_dir: process.cwd(),
      history: this.history.slice(-20), // Last 20 entries
    };

    // Get environment from shell session
    if (this.shellSession) {
      state.env_vars = this.shellSession.getEnv();
      state.working_dir = this.shellSession.getWorkdir();
    }

    // Get imports from python session
    if (this.pythonSession) {
      state.imports = this.pythonSession.getImports();
      state.env_vars = { ...state.env_vars, ...this.pythonSession.getEnv() };
    }

    return state;
  }

  /**
   * Reset the session (clear all state)
   */
  async reset(): Promise<void> {
    if (!this.isAlive) {
      throw new Error("Session has been terminated");
    }

    if (this.shellSession) {
      await this.shellSession.reset();
    }
    if (this.pythonSession) {
      await this.pythonSession.reset();
    }

    this.history = [];
    this.updateActivityTime();
  }

  /**
   * Get command history
   */
  getHistory(limit: number = 50): RuntimeHistoryEntry[] {
    return this.history.slice(-limit);
  }

  /**
   * Terminate the session and cleanup resources
   */
  async terminate(): Promise<void> {
    if (!this.isAlive) {
      return;
    }

    this.isAlive = false;

    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
    }

    if (this.shellSession) {
      await this.shellSession.terminate();
    }
    if (this.pythonSession) {
      await this.pythonSession.terminate();
    }

    this.emit("terminated");
  }

  /**
   * Check if session is still alive
   */
  isAliveCheck(): boolean {
    return this.isAlive;
  }

  /**
   * Get last activity time
   */
  getLastActivityTime(): number {
    return this.lastActivityTime;
  }

  /**
   * Update activity time and reset timeout
   */
  private updateActivityTime(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Record command in history with size management
   */
  private recordHistory(entry: RuntimeHistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
  }

  /**
   * Start tracking inactivity timeout
   */
  private startTimeoutTracker(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
    }

    this.timeoutHandle = setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivityTime;
      if (timeSinceActivity > this.timeoutMs) {
        this.terminate().catch((err) => {
          console.error("Error terminating session:", err);
        });
      }
    }, 5000); // Check every 5 seconds
  }
}

/**
 * Global runtime session manager
 */
class RuntimeSessionManager extends EventEmitter {
  private sessions = new Map<string, RuntimeSession>();

  /**
   * Get or create a session for a workspace
   */
  getOrCreateSession(workspaceId: string, config?: Partial<SessionConfig>): RuntimeSession {
    if (this.sessions.has(workspaceId)) {
      const session = this.sessions.get(workspaceId)!;
      if (session.isAliveCheck()) {
        return session;
      }
      // Session is dead, remove and create new one
      this.sessions.delete(workspaceId);
    }

    const session = new RuntimeSession({
      workspaceId,
      timeoutMs: config?.timeoutMs,
      maxHistorySize: config?.maxHistorySize,
    });

    session.on("terminated", () => {
      this.sessions.delete(workspaceId);
    });

    this.sessions.set(workspaceId, session);
    return session;
  }

  /**
   * Get an existing session if alive
   */
  getSession(workspaceId: string): RuntimeSession | null {
    const session = this.sessions.get(workspaceId);
    if (session && session.isAliveCheck()) {
      return session;
    }
    if (session) {
      this.sessions.delete(workspaceId);
    }
    return null;
  }

  /**
   * Terminate a specific session
   */
  async terminateSession(workspaceId: string): Promise<void> {
    const session = this.sessions.get(workspaceId);
    if (session) {
      await session.terminate();
      this.sessions.delete(workspaceId);
    }
  }

  /**
   * Terminate all sessions
   */
  async terminateAll(): Promise<void> {
    for (const [id, session] of this.sessions.entries()) {
      try {
        await session.terminate();
      } catch (err) {
        console.error(`Error terminating session ${id}:`, err);
      }
    }
    this.sessions.clear();
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Map<string, RuntimeSession> {
    return new Map(this.sessions);
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
}

export const globalRuntimeManager = new RuntimeSessionManager();
