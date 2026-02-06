/**
 * Shell Session Handler
 *
 * Maintains a long-lived shell process (bash) with persistent environment
 * and working directory across multiple command executions.
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import type { RuntimeOutput } from "./runtime-manager.js";

interface ShellSessionConfig {
  workspaceId: string;
  shell?: string;
}

const sleep = promisify(setTimeout);

/**
 * Maintains a persistent bash shell session
 */
export class ShellSession {
  private process: ChildProcessWithoutNullStreams | null = null;
  private workspaceId: string;
  private shell: string;
  private env: Record<string, string>;
  private workdir: string;
  private commandCounter: number = 0;
  private isInitialized: boolean = false;
  private isTerminating: boolean = false;

  constructor(config: ShellSessionConfig) {
    this.workspaceId = config.workspaceId;
    this.shell = config.shell ?? "/bin/bash";
    this.env = { ...process.env } as Record<string, string>;
    this.workdir = process.cwd();
  }

  /**
   * Initialize the shell process if not already done
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized || this.process) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.shell, ["-i", "-s"], {
          stdio: ["pipe", "pipe", "pipe"],
          env: this.env,
          cwd: this.workdir,
        });

        if (!this.process) {
          reject(new Error("Failed to spawn shell process"));
          return;
        }

        // Give the shell a moment to start
        setTimeout(() => {
          this.isInitialized = true;
          resolve();
        }, 100);

        this.process.on("error", (err) => {
          console.error("Shell process error:", err);
        });

        this.process.on("exit", (code) => {
          if (!this.isTerminating) {
            console.warn(`Shell process exited unexpectedly with code ${code}`);
            this.process = null;
            this.isInitialized = false;
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Execute a command in the shell
   */
  async execute(command: string, timeout: number = 30000): Promise<RuntimeOutput> {
    if (this.isTerminating) {
      throw new Error("Shell session is being terminated");
    }

    await this.initialize();

    if (!this.process || !this.process.stdin || !this.process.stdout) {
      throw new Error("Shell process not available");
    }

    return new Promise((resolve) => {
      const markerId = `__SHELL_CMD_${++this.commandCounter}_END__`;
      const errorMarkerId = `__SHELL_CMD_${this.commandCounter}_ERR__`;
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let isResolved = false;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        // Try to send Ctrl+C
        if (this.process && this.process.stdin) {
          try {
            this.process.stdin.write("\u0003"); // Ctrl+C
          } catch (err) {
            console.error("Error sending Ctrl+C:", err);
          }
        }

        if (!isResolved) {
          isResolved = true;
          resolve({
            stdout,
            stderr: stderr + `\nTimeout after ${timeout}ms`,
            error: `Command timeout after ${timeout}ms`,
          });
        }
      }, timeout);

      const stdoutListener = (data: Buffer) => {
        const text = data.toString();
        stdout += text;

        if (stdout.includes(markerId)) {
          clearTimeout(timeoutHandle);

          // Extract the actual output before the marker
          const lines = stdout.split("\n");
          const markerIndex = lines.findIndex((l) => l.includes(markerId));

          if (markerIndex >= 0) {
            stdout = lines.slice(0, markerIndex).join("\n");

            // Extract exit code from the line before the marker
            let exitCode = 0;
            if (markerIndex > 0) {
              const lastLine = lines[markerIndex - 1];
              if (lastLine.includes(errorMarkerId)) {
                const parts = lastLine.split("|");
                if (parts.length > 1) {
                  exitCode = parseInt(parts[1], 10);
                }
              }
            }

            cleanup();

            if (!isResolved) {
              isResolved = true;
              resolve({
                stdout: stdout.trimEnd(),
                stderr: stderr.trimEnd(),
                exitCode: timedOut ? undefined : exitCode,
                error: timedOut ? `Timeout after ${timeout}ms` : undefined,
              });
            }
          }
        }
      };

      const stderrListener = (data: Buffer) => {
        const text = data.toString();
        stderr += text;
      };

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        if (this.process && this.process.stdout) {
          this.process.stdout.removeListener("data", stdoutListener);
        }
        if (this.process && this.process.stderr) {
          this.process.stderr.removeListener("data", stderrListener);
        }
      };

      try {
        if (this.process.stdout) {
          this.process.stdout.on("data", stdoutListener);
        }
        if (this.process.stderr) {
          this.process.stderr.on("data", stderrListener);
        }

        // Send command with markers to detect completion
        // We use 'set -e' to exit on error and capture the exit code
        const wrappedCommand = `${command}; echo "${errorMarkerId}|$?"; echo "${markerId}"`;
        this.process.stdin!.write(wrappedCommand + "\n");
      } catch (error) {
        cleanup();
        if (!isResolved) {
          isResolved = true;
          resolve({
            stdout,
            stderr: String(error),
            error: String(error),
          });
        }
      }
    });
  }

  /**
   * Get current environment variables
   */
  getEnv(): Record<string, string> {
    return { ...this.env };
  }

  /**
   * Get current working directory
   */
  getWorkdir(): string {
    return this.workdir;
  }

  /**
   * Set an environment variable
   */
  async setEnv(key: string, value: string): Promise<void> {
    this.env[key] = value;
    await this.execute(`export ${key}="${value.replace(/"/g, '\\"')}"`);
  }

  /**
   * Change working directory
   */
  async changeDir(dir: string): Promise<void> {
    const result = await this.execute(`cd "${dir.replace(/"/g, '\\"')}" && pwd`);
    if (result.exitCode === 0) {
      this.workdir = result.stdout.trim();
    } else {
      throw new Error(`Failed to change directory: ${result.stderr}`);
    }
  }

  /**
   * Reset the shell (clear environment, return to initial directory)
   */
  async reset(): Promise<void> {
    this.env = { ...process.env } as Record<string, string>;
    this.workdir = process.cwd();

    if (this.process) {
      await this.execute("exit");
      this.process = null;
      this.isInitialized = false;
    }
  }

  /**
   * Terminate the shell process
   */
  async terminate(): Promise<void> {
    this.isTerminating = true;

    if (this.process) {
      return new Promise((resolve) => {
        if (!this.process) {
          resolve();
          return;
        }

        try {
          this.process.stdin?.write("exit\n");
        } catch (err) {
          console.error("Error sending exit:", err);
        }

        const timeoutHandle = setTimeout(() => {
          if (this.process) {
            this.process.kill("SIGTERM");
            setTimeout(() => {
              if (this.process) {
                this.process.kill("SIGKILL");
              }
              resolve();
            }, 1000);
          } else {
            resolve();
          }
        }, 2000);

        this.process.on("exit", () => {
          clearTimeout(timeoutHandle);
          this.process = null;
          resolve();
        });
      });
    }
  }
}
