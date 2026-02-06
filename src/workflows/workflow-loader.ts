/**
 * Workflow Loader
 * Loads workflows from the workspace and manages workflow storage
 */

import * as fs from "fs";
import * as path from "path";
import type { WorkflowDefinition } from "./types.js";
import { WorkflowParser } from "./workflow-parser.js";

export interface WorkflowMetadata {
  name: string;
  version?: string;
  description?: string;
  filePath: string;
  lastModified: number;
  tags?: string[];
}

export class WorkflowLoader {
  private workflowsDir: string;
  private logsDir: string;
  private cache = new Map<string, WorkflowDefinition>();

  constructor(workflowsDir?: string, logsDir?: string) {
    this.workflowsDir =
      workflowsDir
      || path.join(process.cwd(), "workflows");
    this.logsDir = logsDir || path.join(this.workflowsDir, "logs");

    // Ensure directories exist
    this.ensureDirectories();
  }

  /**
   * Ensure required directories exist
   */
  private ensureDirectories(): void {
    if (!fs.existsSync(this.workflowsDir)) {
      fs.mkdirSync(this.workflowsDir, { recursive: true });
    }
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Load a workflow by name
   */
  loadWorkflow(name: string): WorkflowDefinition {
    // Check cache
    if (this.cache.has(name)) {
      return this.cache.get(name)!;
    }

    // Find workflow file
    const filePath = this.findWorkflowFile(name);
    if (!filePath) {
      throw new Error(`Workflow not found: ${name}`);
    }

    // Parse and cache
    const workflow = WorkflowParser.parseFile(filePath);
    this.cache.set(name, workflow);

    return workflow;
  }

  /**
   * Find a workflow file by name
   */
  private findWorkflowFile(name: string): string | undefined {
    const extensions = [".yaml", ".yml", ".json"];

    for (const ext of extensions) {
      const filePath = path.join(this.workflowsDir, `${name}${ext}`);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }

    return undefined;
  }

  /**
   * List all available workflows
   */
  listWorkflows(): WorkflowMetadata[] {
    const workflows: WorkflowMetadata[] = [];

    if (!fs.existsSync(this.workflowsDir)) {
      return workflows;
    }

    const files = fs.readdirSync(this.workflowsDir);

    for (const file of files) {
      const filePath = path.join(this.workflowsDir, file);
      const stats = fs.statSync(filePath);

      if (!stats.isFile()) {
        continue;
      }

      const ext = path.extname(file).toLowerCase();
      if (![".yaml", ".yml", ".json"].includes(ext)) {
        continue;
      }

      try {
        const workflow = WorkflowParser.parseFile(filePath);
        workflows.push({
          name: workflow.name,
          version: workflow.version,
          description: workflow.description,
          filePath,
          lastModified: stats.mtimeMs,
          tags: workflow.tags,
        });
      } catch (error) {
        console.warn(`Failed to parse workflow ${file}:`, error);
      }
    }

    return workflows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Save a workflow definition to file
   */
  saveWorkflow(
    workflow: WorkflowDefinition,
    format: "yaml" | "json" = "yaml",
  ): string {
    const fileName = `${workflow.name}.${format === "yaml" ? "yaml" : "json"}`;
    const filePath = path.join(this.workflowsDir, fileName);

    let content: string;
    if (format === "yaml") {
      content = this.toYaml(workflow);
    } else {
      content = JSON.stringify(workflow, null, 2);
    }

    fs.writeFileSync(filePath, content, "utf-8");
    this.cache.delete(workflow.name);

    return filePath;
  }

  /**
   * Delete a workflow file
   */
  deleteWorkflow(name: string): boolean {
    const filePath = this.findWorkflowFile(name);
    if (!filePath) {
      return false;
    }

    fs.unlinkSync(filePath);
    this.cache.delete(name);

    return true;
  }

  /**
   * Clear the workflow cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Save execution log
   */
  saveExecutionLog(executionId: string, log: unknown): string {
    const logPath = path.join(this.logsDir, `${executionId}.json`);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");
    return logPath;
  }

  /**
   * Read execution log
   */
  readExecutionLog(executionId: string): unknown {
    const logPath = path.join(this.logsDir, `${executionId}.json`);
    if (!fs.existsSync(logPath)) {
      return undefined;
    }

    return JSON.parse(fs.readFileSync(logPath, "utf-8"));
  }

  /**
   * List execution logs
   */
  listExecutionLogs(): Array<{ executionId: string; timestamp: number }> {
    const logs: Array<{ executionId: string; timestamp: number }> = [];

    if (!fs.existsSync(this.logsDir)) {
      return logs;
    }

    const files = fs.readdirSync(this.logsDir);

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const executionId = file.slice(0, -5);
      const filePath = path.join(this.logsDir, file);
      const stats = fs.statSync(filePath);

      logs.push({
        executionId,
        timestamp: stats.mtimeMs,
      });
    }

    return logs.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Convert workflow to YAML string
   * Simple YAML serialization
   */
  private toYaml(obj: unknown, indent = 0): string {
    const spaces = " ".repeat(indent);

    if (obj === null || obj === undefined) {
      return "null";
    }

    if (typeof obj === "boolean" || typeof obj === "number") {
      return String(obj);
    }

    if (typeof obj === "string") {
      // Check if string needs quoting
      if (obj.includes(":") || obj.includes("#") || obj.includes("\n")) {
        return `"${obj.replace(/"/g, '\\"')}"`;
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return "[]";
      }
      const items = obj.map((item) => {
        const itemStr = this.toYaml(item, indent + 2);
        return `${spaces}- ${itemStr}`;
      });
      return "\n" + items.join("\n");
    }

    if (typeof obj === "object") {
      const dict = obj as Record<string, unknown>;
      const keys = Object.keys(dict);

      if (keys.length === 0) {
        return "{}";
      }

      const pairs = keys.map((key) => {
        const value = this.toYaml(dict[key], indent + 2);
        if (value.includes("\n")) {
          return `${spaces}${key}:${value}`;
        }
        return `${spaces}${key}: ${value}`;
      });

      return "\n" + pairs.join("\n");
    }

    return String(obj);
  }
}
