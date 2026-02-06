/**
 * Pipeline Engine
 * Core workflow execution engine with support for conditions, retries, and loops
 */

import { randomUUID } from "crypto";
import type {
  ExecutionContext,
  WorkflowDefinition,
  WorkflowExecutionResult,
} from "./types.js";
import { StepExecutor } from "./workflow-executor.js";

export class PipelineEngine {
  private executor = new StepExecutor();
  private timeoutMs = 300000; // 5 minutes default

  /**
   * Register a tool handler
   */
  registerTool(
    tool: string,
    handler: (input: unknown, options?: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.executor.registerTool(tool, handler);
  }

  /**
   * Set global timeout for workflow execution
   */
  setGlobalTimeout(ms: number): void {
    this.timeoutMs = ms;
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflow: WorkflowDefinition,
    variables: Record<string, unknown> = {},
  ): Promise<WorkflowExecutionResult> {
    const executionId = randomUUID();
    const startTime = Date.now();

    const context: ExecutionContext = {
      workflow,
      currentStepIndex: 0,
      startTime,
      variables: {
        ...workflow.variables,
        ...variables,
      },
      stepOutputs: new Map(),
      globalOutputs: new Map(),
    };

    const steps = [];
    let completedSteps = 0;
    let failedSteps = 0;
    let skippedSteps = 0;
    let status: "completed" | "failed" | "halted" | "timeout" = "completed";
    let fatalError: Error | undefined;

    try {
      // Execute each step
      for (let i = 0; i < workflow.steps.length; i++) {
        // Check timeout
        if (Date.now() - startTime > (workflow.timeout || this.timeoutMs)) {
          status = "timeout";
          fatalError = new Error("Workflow execution timeout");
          break;
        }

        context.currentStepIndex = i;
        const step = workflow.steps[i];

        // Handle loops
        if (step.loop) {
          const loopResults = await this.executeLoopedStep(step, context);
          steps.push(...loopResults);

          const loopFailures = loopResults.filter(
            (r) => r.status === "failed",
          );
          if (loopFailures.length > 0) {
            if (step.onError === "halt") {
              status = "halted";
              fatalError = loopFailures[0].error;
              break;
            }
            failedSteps += loopFailures.length;
          } else {
            completedSteps += loopResults.filter(
              (r) => r.status === "success",
            ).length;
            skippedSteps += loopResults.filter(
              (r) => r.status === "skipped",
            ).length;
          }
        } else {
          // Execute single step
          const result = await this.executor.executeStep(step, context);
          steps.push(result);

          if (result.status === "success") {
            completedSteps += 1;
          } else if (result.status === "failed") {
            failedSteps += 1;
            if (step.onError === "halt") {
              status = "halted";
              fatalError = result.error;
              break;
            }
          } else if (result.status === "skipped") {
            skippedSteps += 1;
          }
        }
      }
    } catch (error) {
      status = "failed";
      fatalError = error instanceof Error
        ? error
        : new Error(String(error));
    }

    const endTime = Date.now();

    // Determine final status
    if (status !== "halted" && status !== "timeout") {
      if (failedSteps > 0) {
        status = "failed";
      } else {
        status = "completed";
      }
    }

    return {
      workflowName: workflow.name,
      workflowVersion: workflow.version,
      status,
      startTime,
      endTime,
      duration: endTime - startTime,
      totalSteps: workflow.steps.length,
      completedSteps,
      failedSteps,
      skippedSteps,
      steps,
      variables: context.variables,
      globalOutputs: Object.fromEntries(context.globalOutputs),
      error: fatalError,
      executionId,
    };
  }

  /**
   * Execute a step with loop configuration
   */
  private async executeLoopedStep(
    step: { loop?: { times?: number; whileCondition?: string; maxIterations?: number }; [key: string]: unknown },
    context: ExecutionContext,
  ) {
    const results = [];
    const maxIterations = step.loop?.maxIterations || 1000;
    let iteration = 0;

    if (step.loop?.times) {
      for (let i = 0; i < step.loop.times && iteration < maxIterations; i++) {
        const result = await this.executor.executeStep(
          step as never,
          context,
        );
        results.push(result);
        iteration++;
      }
    } else if (step.loop?.whileCondition) {
      while (iteration < maxIterations) {
        // Evaluate condition (simplified - would need proper evaluator)
        const shouldContinue = true; // TODO: implement condition evaluation
        if (!shouldContinue) break;

        const result = await this.executor.executeStep(
          step as never,
          context,
        );
        results.push(result);
        iteration++;

        if (result.status === "failed") break;
      }
    }

    return results;
  }

  /**
   * Get registered tool handlers
   */
  getToolHandlers(): string[] {
    return this.executor.getToolHandlers();
  }
}

export default new PipelineEngine();
