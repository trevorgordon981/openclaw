/**
 * Workflow Parser
 * Parses YAML/JSON workflow definitions and validates them
 */

import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import type { WorkflowDefinition, WorkflowStep } from "./types.js";

export class WorkflowParser {
  /**
   * Parse a workflow from YAML or JSON file
   */
  static parseFile(filePath: string): WorkflowDefinition {
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Workflow file not found: ${fullPath}`);
    }

    const content = fs.readFileSync(fullPath, "utf-8");
    const ext = path.extname(fullPath).toLowerCase();

    if (ext === ".yaml" || ext === ".yml") {
      return this.parseYaml(content);
    } else if (ext === ".json") {
      return this.parseJson(content);
    } else {
      throw new Error(
        `Unsupported file format: ${ext}. Use .yaml or .json`,
      );
    }
  }

  /**
   * Parse a workflow from YAML string
   */
  static parseYaml(content: string): WorkflowDefinition {
    const parsed = parseYaml(content);
    return this.normalizeAndValidate(parsed);
  }

  /**
   * Parse a workflow from JSON string
   */
  static parseJson(content: string): WorkflowDefinition {
    const parsed = JSON.parse(content);
    return this.normalizeAndValidate(parsed);
  }

  /**
   * Parse a workflow definition object
   */
  static parse(def: unknown): WorkflowDefinition {
    return this.normalizeAndValidate(def);
  }

  /**
   * Normalize and validate the workflow definition
   */
  private static normalizeAndValidate(
    def: unknown,
  ): WorkflowDefinition {
    if (typeof def !== "object" || def === null) {
      throw new Error("Workflow definition must be an object");
    }

    const workflow = def as Record<string, unknown>;

    // Required fields
    if (!workflow.name || typeof workflow.name !== "string") {
      throw new Error("Workflow must have a string 'name' field");
    }

    if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
      throw new Error("Workflow must have at least one step");
    }

    // Validate steps
    const steps = (workflow.steps as unknown[]).map((step, index) =>
      this.normalizeStep(step, index),
    );

    return {
      name: workflow.name,
      version: workflow.version ? String(workflow.version) : undefined,
      description: workflow.description
        ? String(workflow.description)
        : undefined,
      tags: Array.isArray(workflow.tags)
        ? workflow.tags.map(String)
        : undefined,
      variables: this.normalizeVariables(workflow.variables),
      timeout: typeof workflow.timeout === "number"
        ? workflow.timeout
        : undefined,
      steps,
      errorHandler: workflow.errorHandler
        ? this.normalizeErrorHandler(workflow.errorHandler)
        : undefined,
      triggers: workflow.triggers
        ? this.normalizeTriggers(workflow.triggers)
        : undefined,
    };
  }

  /**
   * Normalize a workflow step
   */
  private static normalizeStep(step: unknown, index: number): WorkflowStep {
    if (typeof step !== "object" || step === null) {
      throw new Error(`Step ${index} must be an object`);
    }

    const s = step as Record<string, unknown>;

    if (!s.tool || typeof s.tool !== "string") {
      throw new Error(`Step ${index} must have a string 'tool' field`);
    }

    const normalized: WorkflowStep = {
      id: s.id ? String(s.id) : `step-${index}`,
      tool: s.tool,
      input: s.input,
      options: typeof s.options === "object"
        ? (s.options as Record<string, unknown>)
        : undefined,
      description: s.description ? String(s.description) : undefined,
      onError: (s.onError as string)
        ? (s.onError as "skip" | "halt" | "continue")
        : "halt",
    };

    if (s.condition) {
      if (typeof s.condition === "string") {
        normalized.condition = { expression: s.condition };
      } else if (typeof s.condition === "object") {
        const cond = s.condition as Record<string, unknown>;
        if (typeof cond.expression === "string") {
          normalized.condition = { expression: cond.expression };
        } else {
          throw new Error(`Step ${index} condition must have 'expression'`);
        }
      }
    }

    if (s.retryPolicy && typeof s.retryPolicy === "object") {
      const rp = s.retryPolicy as Record<string, unknown>;
      normalized.retryPolicy = {
        maxRetries: typeof rp.maxRetries === "number"
          ? rp.maxRetries
          : 3,
        initialDelayMs: typeof rp.initialDelayMs === "number"
          ? rp.initialDelayMs
          : 1000,
        maxDelayMs: typeof rp.maxDelayMs === "number"
          ? rp.maxDelayMs
          : 30000,
        backoffMultiplier: typeof rp.backoffMultiplier === "number"
          ? rp.backoffMultiplier
          : 2,
        retryOnErrors: Array.isArray(rp.retryOnErrors)
          ? rp.retryOnErrors.map(String)
          : undefined,
      };
    }

    if (s.loop && typeof s.loop === "object") {
      const loop = s.loop as Record<string, unknown>;
      normalized.loop = {
        times: typeof loop.times === "number" ? loop.times : undefined,
        whileCondition: loop.whileCondition
          ? String(loop.whileCondition)
          : undefined,
        maxIterations: typeof loop.maxIterations === "number"
          ? loop.maxIterations
          : 1000,
      };
    }

    return normalized;
  }

  /**
   * Normalize variables
   */
  private static normalizeVariables(
    variables: unknown,
  ): Record<string, unknown> | undefined {
    if (!variables) {
      return undefined;
    }

    if (typeof variables !== "object" || Array.isArray(variables)) {
      throw new Error("Variables must be an object");
    }

    return variables as Record<string, unknown>;
  }

  /**
   * Normalize error handler
   */
  private static normalizeErrorHandler(handler: unknown) {
    if (typeof handler !== "object" || handler === null) {
      throw new Error("Error handler must be an object");
    }

    const h = handler as Record<string, unknown>;

    return {
      channel: h.channel ? String(h.channel) : undefined,
      message: h.message ? String(h.message) : undefined,
      onErrors: Array.isArray(h.onErrors)
        ? h.onErrors.map(String)
        : undefined,
    };
  }

  /**
   * Normalize triggers
   */
  private static normalizeTriggers(triggers: unknown) {
    if (typeof triggers !== "object" || triggers === null) {
      throw new Error("Triggers must be an object");
    }

    const t = triggers as Record<string, unknown>;

    return {
      cron: t.cron ? String(t.cron) : undefined,
      systemEvent: t.systemEvent ? String(t.systemEvent) : undefined,
      manual: t.manual === true ? true : undefined,
    };
  }
}
