/**
 * Workflow Definition Types
 * Defines the structure for workflow YAML/JSON definitions
 */

export interface StepRetryPolicy {
  /** Maximum number of retries */
  maxRetries?: number;
  /** Initial delay in milliseconds (exponential backoff) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds */
  maxDelayMs?: number;
  /** Backoff multiplier */
  backoffMultiplier?: number;
  /** Retry only on specific error codes */
  retryOnErrors?: string[];
}

export interface StepCondition {
  /** Condition expression to evaluate (e.g., "exit_code == 0", "output.success == true") */
  expression: string;
}

export interface WorkflowStep {
  /** Unique step identifier */
  id?: string;
  /** Tool name to execute (e.g., "exec", "read", "write", "message", "browser") */
  tool: string;
  /** Tool input - can reference previous outputs with {stepId.output} */
  input?: unknown;
  /** Tool-specific options */
  options?: Record<string, unknown>;
  /** Condition for executing this step */
  condition?: StepCondition | string;
  /** Retry policy for this step */
  retryPolicy?: StepRetryPolicy;
  /** Description of what this step does */
  description?: string;
  /** Loop configuration - repeat N times or while condition */
  loop?: {
    times?: number;
    whileCondition?: string;
    maxIterations?: number;
  };
  /** On error behavior: "skip", "halt", or "continue" */
  onError?: "skip" | "halt" | "continue";
}

export interface WorkflowErrorHandler {
  /** Notification channel for errors (e.g., "slack", "email") */
  channel?: string;
  /** Message template for error notification */
  message?: string;
  /** Send notification on specific error types */
  onErrors?: string[];
}

export interface WorkflowDefinition {
  /** Workflow name */
  name: string;
  /** Workflow version */
  version?: string;
  /** Workflow description */
  description?: string;
  /** Workflow tags for categorization */
  tags?: string[];
  /** Global variables available to all steps */
  variables?: Record<string, unknown>;
  /** Workflow execution timeout in milliseconds */
  timeout?: number;
  /** Steps to execute in order */
  steps: WorkflowStep[];
  /** Error handling configuration */
  errorHandler?: WorkflowErrorHandler;
  /** Triggers for this workflow (cron, system event, etc.) */
  triggers?: {
    cron?: string;
    systemEvent?: string;
    manual?: boolean;
  };
}

/**
 * Execution Context - passed through steps and available in conditions/inputs
 */
export interface ExecutionContext {
  workflow: WorkflowDefinition;
  currentStepIndex: number;
  startTime: number;
  variables: Record<string, unknown>;
  stepOutputs: Map<string, unknown>;
  globalOutputs: Map<string, unknown>;
}

/**
 * Step Execution Result
 */
export interface StepExecutionResult {
  stepId: string;
  stepIndex: number;
  tool: string;
  status: "success" | "failed" | "skipped" | "retried";
  output?: unknown;
  error?: Error;
  duration: number;
  retryCount?: number;
  timestamp: number;
}

/**
 * Workflow Execution Result
 */
export interface WorkflowExecutionResult {
  workflowName: string;
  workflowVersion?: string;
  status: "completed" | "failed" | "halted" | "timeout";
  startTime: number;
  endTime: number;
  duration: number;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  steps: StepExecutionResult[];
  variables: Record<string, unknown>;
  globalOutputs: Record<string, unknown>;
  error?: Error;
  executionId: string;
}
