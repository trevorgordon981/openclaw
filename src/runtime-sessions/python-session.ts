/**
 * Python Session Handler
 *
 * Maintains a long-lived Python process with persistent imports, variables,
 * and functions across multiple executions.
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeOutput } from "./runtime-manager.js";

interface PythonSessionConfig {
  workspaceId: string;
  pythonCmd?: string;
}

const sleep = promisify(setTimeout);

/**
 * Maintains a persistent Python session
 */
export class PythonSession {
  private process: ChildProcessWithoutNullStreams | null = null;
  private workspaceId: string;
  private pythonCmd: string;
  private env: Record<string, string>;
  private imports: Set<string> = new Set();
  private commandCounter: number = 0;
  private isInitialized: boolean = false;
  private isTerminating: boolean = false;

  constructor(config: PythonSessionConfig) {
    this.workspaceId = config.workspaceId;
    this.pythonCmd = config.pythonCmd ?? "python3";
    this.env = { ...process.env } as Record<string, string>;
  }

  /**
   * Initialize the Python process if not already done
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized || this.process) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.pythonCmd, ["-i", "-u"], {
          stdio: ["pipe", "pipe", "pipe"],
          env: this.env,
        });

        if (!this.process) {
          reject(new Error("Failed to spawn Python process"));
          return;
        }

        // Give Python a moment to start
        setTimeout(() => {
          this.isInitialized = true;
          resolve();
        }, 200);

        this.process.on("error", (err) => {
          console.error("Python process error:", err);
        });

        this.process.on("exit", (code) => {
          if (!this.isTerminating) {
            console.warn(`Python process exited unexpectedly with code ${code}`);
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
   * Execute Python code in the session
   */
  async execute(code: string, timeout: number = 30000): Promise<RuntimeOutput> {
    if (this.isTerminating) {
      throw new Error("Python session is being terminated");
    }

    await this.initialize();

    if (!this.process || !this.process.stdin || !this.process.stdout) {
      throw new Error("Python process not available");
    }

    return new Promise((resolve) => {
      const markerId = `__PYTHON_CMD_${++this.commandCounter}_END__`;
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

            // Track imports from the code
            this.trackImports(code);

            cleanup();

            if (!isResolved) {
              isResolved = true;
              resolve({
                stdout: stdout.trimEnd(),
                stderr: stderr.trimEnd(),
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

        // Escape code properly for Python
        const escapedCode = code
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/'/g, "\\'");

        // Use Python's exec to run the code and mark completion
        const wrapper = `exec("""${code.replace(/"""/g, '\\"""')}\n""")\nprint("${markerId}")`;
        this.process.stdin!.write(wrapper + "\n");
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
   * Track imports from executed code
   */
  private trackImports(code: string): void {
    // Simple regex-based import detection
    const importPattern =
      /(?:from\s+[\w.]+\s+)?import\s+([^;:\n]*)/g;
    let match;

    while ((match = importPattern.exec(code)) !== null) {
      const imports = match[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("("));

      for (const imp of imports) {
        // Extract just the module/function name
        const parts = imp.split(" as ");
        const name = parts[0].trim();
        if (name) {
          this.imports.add(name);
        }
      }
    }
  }

  /**
   * Get list of imported modules/packages
   */
  getImports(): string[] {
    return Array.from(this.imports);
  }

  /**
   * Get environment variables
   */
  getEnv(): Record<string, string> {
    return { ...this.env };
  }

  /**
   * Get current working directory from Python's perspective
   */
  async getWorkdir(): Promise<string> {
    const result = await this.execute("import os; print(os.getcwd())");
    return result.stdout.trim();
  }

  /**
   * Reset the Python session
   */
  async reset(): Promise<void> {
    this.imports.clear();
    this.env = { ...process.env } as Record<string, string>;

    if (this.process) {
      await this.execute("exit()");
      this.process = null;
      this.isInitialized = false;
    }
  }

  /**
   * Terminate the Python process
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
          this.process.stdin?.write("exit()\n");
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
