import type { Command } from "commander";
import { quickstartCommand } from "../commands/quickstart.js";

export function registerQuickstartCli(program: Command) {
  program
    .command("quickstart")
    .alias("qs")
    .description("Guided setup wizard for common deployment scenarios")
    .argument("[scenario]", "Setup scenario: local, cloud, slack, node")
    .option("--non-interactive", "Run without prompts (requires scenario)")
    .action(async (scenario?: string, opts?: { nonInteractive?: boolean }) => {
      const validScenarios = ["local", "cloud", "slack", "node"] as const;
      const normalizedScenario = scenario?.toLowerCase();
      
      if (scenario && !validScenarios.includes(normalizedScenario as typeof validScenarios[number])) {
        console.error(`Invalid scenario: ${scenario}`);
        console.error(`Valid options: ${validScenarios.join(", ")}`);
        process.exit(1);
      }

      await quickstartCommand({
        scenario: normalizedScenario as "local" | "cloud" | "slack" | "node" | undefined,
        nonInteractive: opts?.nonInteractive,
      });
    });
}
