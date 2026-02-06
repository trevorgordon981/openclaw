/**
 * Workflow CLI
 * Command-line interface for managing and running workflows
 */

import type { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { PipelineEngine } from "../workflows/pipeline-engine.js";
import { WorkflowLoader } from "../workflows/workflow-loader.js";
import { WorkflowParser } from "../workflows/workflow-parser.js";

const engine = new PipelineEngine();

// Initialize tool handlers with placeholders
// These will be properly integrated with OpenClaw's tool system
export function initializeToolHandlers(
  toolImplementations: Record<string, any>,
) {
  for (const [toolName, implementation] of Object.entries(toolImplementations)) {
    if (implementation && typeof implementation === "function") {
      engine.registerTool(toolName, implementation);
    }
  }
}

export function registerWorkflowCli(program: Command) {
  const workflow = program
    .command("workflow")
    .description("Manage and execute workflows");

  // workflow list
  workflow
    .command("list")
    .description("List all available workflows")
    .action(async (options: any) => {
      try {
        const workflowsDir = path.join(
          process.cwd(),
          "workflows",
        );
        const loader = new WorkflowLoader(workflowsDir);
        const workflows = loader.listWorkflows();

        if (workflows.length === 0) {
          console.log("No workflows found");
          return;
        }

        console.log("\nAvailable Workflows:");
        console.log("─".repeat(80));

        for (const wf of workflows) {
          console.log(`\n📋 ${wf.name}`);
          if (wf.version) console.log(`   Version: ${wf.version}`);
          if (wf.description) console.log(`   ${wf.description}`);
          if (wf.tags && wf.tags.length > 0) {
            console.log(`   Tags: ${wf.tags.join(", ")}`);
          }
          console.log(`   File: ${path.basename(wf.filePath)}`);
        }

        console.log("\n" + "─".repeat(80));
        console.log(`Total: ${workflows.length} workflow(s)\n`);
      } catch (error) {
        console.error("Error listing workflows:", error);
        process.exit(1);
      }
    });

  // workflow show
  workflow
    .command("show <name>")
    .description("Show workflow definition")
    .action(async (name: string) => {
      try {
        const workflowsDir = path.join(
          process.cwd(),
          "workflows",
        );
        const loader = new WorkflowLoader(workflowsDir);
        const wf = loader.loadWorkflow(name);

        console.log("\nWorkflow Definition:");
        console.log("─".repeat(80));
        console.log(JSON.stringify(wf, null, 2));
        console.log("─".repeat(80) + "\n");
      } catch (error) {
        console.error("Error loading workflow:", error);
        process.exit(1);
      }
    });

  // workflow run
  workflow
    .command("run <name>")
    .description("Execute a workflow")
    .option("--vars <json>", "Workflow variables as JSON")
    .option("--timeout <ms>", "Execution timeout in milliseconds", "300000")
    .option("--save-log", "Save execution log to file")
    .action(async (name: string, options: any) => {
      try {
        const workflowsDir = path.join(
          process.cwd(),
          "workflows",
        );
        const loader = new WorkflowLoader(workflowsDir);
        const wf = loader.loadWorkflow(name);

        // Parse variables
        let variables = {};
        if (options.vars) {
          try {
            variables = JSON.parse(options.vars);
          } catch {
            console.error("Invalid JSON in --vars");
            process.exit(1);
          }
        }

        // Set timeout
        engine.setGlobalTimeout(parseInt(options.timeout, 10));

        console.log(`\n⚙️  Executing workflow: ${name}`);
        console.log("─".repeat(80));

        const startTime = Date.now();
        const result = await engine.executeWorkflow(wf, variables);
        const duration = result.duration / 1000;

        console.log(`✅ Workflow ${result.status.toUpperCase()}`);
        console.log(`⏱️  Duration: ${duration.toFixed(2)}s`);
        console.log(`📊 Steps: ${result.completedSteps}/${result.totalSteps} completed`);
        if (result.failedSteps > 0) console.log(`❌ Failed: ${result.failedSteps}`);
        if (result.skippedSteps > 0) console.log(`⊘ Skipped: ${result.skippedSteps}`);

        if (result.error) {
          console.log(`\n❌ Error: ${result.error.message}`);
        }

        // Save log if requested
        if (options.saveLog) {
          const logPath = loader.saveExecutionLog(result.executionId, result);
          console.log(`\n📝 Log saved to: ${logPath}`);
        }

        console.log("─".repeat(80) + "\n");

        process.exit(result.status === "completed" ? 0 : 1);
      } catch (error) {
        console.error("Error running workflow:", error);
        process.exit(1);
      }
    });

  // workflow validate
  workflow
    .command("validate <file>")
    .description("Validate a workflow definition file")
    .action(async (file: string) => {
      try {
        const fullPath = path.resolve(file);

        if (!fs.existsSync(fullPath)) {
          console.error(`File not found: ${fullPath}`);
          process.exit(1);
        }

        const wf = WorkflowParser.parseFile(fullPath);

        console.log(`\n✅ Valid workflow: ${wf.name}`);
        console.log(`   Version: ${wf.version || "unspecified"}`);
        console.log(`   Steps: ${wf.steps.length}`);
        console.log(`   Description: ${wf.description || "none"}`);
        console.log();

        process.exit(0);
      } catch (error) {
        console.error("❌ Invalid workflow:", error);
        process.exit(1);
      }
    });

  // workflow logs
  workflow
    .command("logs")
    .description("List execution logs")
    .action(async () => {
      try {
        const workflowsDir = path.join(
          process.cwd(),
          "workflows",
        );
        const loader = new WorkflowLoader(workflowsDir);
        const logs = loader.listExecutionLogs();

        if (logs.length === 0) {
          console.log("No execution logs found");
          return;
        }

        console.log("\nExecution Logs:");
        console.log("─".repeat(80));

        for (const log of logs.slice(0, 10)) {
          const date = new Date(log.timestamp);
          console.log(`${log.executionId} - ${date.toISOString()}`);
        }

        if (logs.length > 10) {
          console.log(`... and ${logs.length - 10} more`);
        }

        console.log("─".repeat(80) + "\n");
      } catch (error) {
        console.error("Error listing logs:", error);
        process.exit(1);
      }
    });

  // workflow log
  workflow
    .command("log <executionId>")
    .description("Show execution log details")
    .action(async (executionId: string) => {
      try {
        const workflowsDir = path.join(
          process.cwd(),
          "workflows",
        );
        const loader = new WorkflowLoader(workflowsDir);
        const log = loader.readExecutionLog(executionId);

        if (!log) {
          console.error(`Log not found: ${executionId}`);
          process.exit(1);
        }

        console.log("\nExecution Log:");
        console.log("─".repeat(80));
        console.log(JSON.stringify(log, null, 2));
        console.log("─".repeat(80) + "\n");
      } catch (error) {
        console.error("Error reading log:", error);
        process.exit(1);
      }
    });
}
