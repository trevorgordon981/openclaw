/**
 * Workflow Executor
 * Handles execution of individual workflow steps and tool invocations
 */

import type {
  ExecutionContext,
  StepExecutionResult,
  WorkflowStep,
} from "./types.js";

/**
 * Tool handler function signature
 */
export type ToolHandler = (
  input: unknown,
  options?: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Tool handler registry
 */
class ToolHandlerRegistry {
  private handlers = new Map<string, ToolHandler>();

  register(tool: string, handler: ToolHandler): void {
    this.handlers.set(tool, handler);
  }

  get(tool: string): ToolHandler | undefined {
    return this.handlers.get(tool);
  }

  has(tool: string): boolean {
    return this.handlers.has(tool);
  }

  list(): string[] {
    return Array.from(this.handlers.keys());
  }
}

/**
 * Step executor with retry logic and condition evaluation
 */
export class StepExecutor {
  private registry = new ToolHandlerRegistry();

  /**
   * Register a tool handler
   */
  registerTool(tool: string, handler: ToolHandler): void {
    this.registry.register(tool, handler);
  }

  /**
   * Get registered tool handlers
   */
  getToolHandlers(): string[] {
    return this.registry.list();
  }

  /**
   * Execute a single step with retry logic
   */
  async executeStep(
    step: WorkflowStep,
    context: ExecutionContext,
  ): Promise<StepExecutionResult> {
    const stepId = step.id || `step-${context.currentStepIndex}`;
    const startTime = Date.now();
    let lastError: Error | undefined;
    let retryCount = 0;

    // Evaluate condition
    if (step.condition) {
      const conditionMet = await this.evaluateCondition(
        step.condition,
        context,
      );
      if (!conditionMet) {
        return {
          stepId,
          stepIndex: context.currentStepIndex,
          tool: step.tool,
          status: "skipped",
          duration: Date.now() - startTime,
          timestamp: Date.now(),
        };
      }
    }

    // Get tool handler
    const handler = this.registry.get(step.tool);
    if (!handler) {
      const error = new Error(`Unknown tool: ${step.tool}`);
      return {
        stepId,
        stepIndex: context.currentStepIndex,
        tool: step.tool,
        status: "failed",
        error,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }

    // Execute with retry logic
    const maxRetries =
      step.retryPolicy?.maxRetries ?? 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        retryCount = attempt;

        // Prepare input (substitute variables)
        const input = await this.prepareInput(step.input, context);

        // Execute tool
        const output = await handler(input, step.options);

        // Store output
        context.stepOutputs.set(stepId, output);

        return {
          stepId,
          stepIndex: context.currentStepIndex,
          tool: step.tool,
          status: "success",
          output,
          duration: Date.now() - startTime,
          timestamp: Date.now(),
          retryCount: attempt,
        };
      } catch (error) {
        lastError = error instanceof Error
          ? error
          : new Error(String(error));

        // Check if we should retry
        if (attempt < maxRetries) {
          const delay = this.calculateBackoffDelay(
            attempt,
            step.retryPolicy,
          );
          await this.sleep(delay);
          continue;
        }

        // Final failure
        if (step.onError === "skip") {
          return {
            stepId,
            stepIndex: context.currentStepIndex,
            tool: step.tool,
            status: "skipped",
            error: lastError,
            duration: Date.now() - startTime,
            timestamp: Date.now(),
            retryCount: attempt,
          };
        }

        return {
          stepId,
          stepIndex: context.currentStepIndex,
          tool: step.tool,
          status: "failed",
          error: lastError,
          duration: Date.now() - startTime,
          timestamp: Date.now(),
          retryCount: attempt,
        };
      }
    }

    // Should not reach here
    return {
      stepId,
      stepIndex: context.currentStepIndex,
      tool: step.tool,
      status: "failed",
      error: lastError || new Error("Unknown error"),
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      retryCount,
    };
  }

  /**
   * Prepare step input by substituting variables and previous outputs
   */
  private async prepareInput(
    input: unknown,
    context: ExecutionContext,
  ): Promise<unknown> {
    if (input === null || input === undefined) {
      return input;
    }

    if (typeof input === "string") {
      return this.substituteVariables(input, context);
    }

    if (typeof input === "object") {
      if (Array.isArray(input)) {
        return Promise.all(
          input.map((item) => this.prepareInput(item, context)),
        );
      }

      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        result[key] = await this.prepareInput(value, context);
      }
      return result;
    }

    return input;
  }

  /**
   * Substitute variables in a string
   * Format: {variableName} or {stepId.output}
   */
  private substituteVariables(text: string, context: ExecutionContext): string {
    let result = text;

    // Replace global variables
    for (const [key, value] of Object.entries(context.variables)) {
      const pattern = new RegExp(`\\{${key}\\}`, "g");
      result = result.replace(pattern, String(value));
    }

    // Replace step outputs
    for (const [stepId, output] of context.stepOutputs) {
      const pattern = new RegExp(`\\{${stepId}\\.output\\}`, "g");
      result = result.replace(pattern, String(output));
    }

    return result;
  }

  /**
   * Evaluate a condition expression
   */
  private async evaluateCondition(
    condition: { expression: string },
    context: ExecutionContext,
  ): Promise<boolean> {
    try {
      // Build evaluation context
      const evalContext: Record<string, unknown> = {
        ...context.variables,
      };

      // Add step outputs
      for (const [stepId, output] of context.stepOutputs) {
        evalContext[stepId] = {
          output,
          success: true, // Add convenience flag
        };
      }

      // Simple expression evaluator
      // Support: ==, !=, >, <, >=, <=, &&, ||, !
      return this.evaluateExpression(condition.expression, evalContext);
    } catch (error) {
      console.error("Error evaluating condition:", error);
      return false;
    }
  }

  /**
   * Evaluate a JavaScript-like expression safely
   * This is a simplified evaluator; for complex expressions, use VM
   */
  private evaluateExpression(
    expression: string,
    context: Record<string, unknown>,
  ): boolean {
    // Create a safe evaluation function
    try {
      // Use Function constructor with restricted scope
      const contextKeys = Object.keys(context);
      const contextValues = Object.values(context);
      const fn = new Function(
        ...contextKeys,
        `"use strict"; return ${expression}`,
      );
      const result = fn(...contextValues);
      return Boolean(result);
    } catch (error) {
      console.error("Expression evaluation failed:", expression, error);
      return false;
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(
    attempt: number,
    retryPolicy?: { initialDelayMs?: number; maxDelayMs?: number; backoffMultiplier?: number },
  ): number {
    const initialDelay = retryPolicy?.initialDelayMs ?? 1000;
    const maxDelay = retryPolicy?.maxDelayMs ?? 30000;
    const multiplier = retryPolicy?.backoffMultiplier ?? 2;

    const delay = initialDelay * Math.pow(multiplier, attempt);
    return Math.min(delay, maxDelay);
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new StepExecutor();
