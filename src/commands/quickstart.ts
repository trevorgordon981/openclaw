/**
 * Quick-start command - streamlined setup for common deployment scenarios.
 *
 * Scenarios:
 * 1. Local (default) - Gateway on this machine, all-in-one
 * 2. Cloud Gateway - Deploy to AWS/VPS, connect Mac as node
 * 3. Slack Bot - Set up Slack integration with guided wizard
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { spawn } from "node:child_process";
import { resolveStateDir } from "../config/paths.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";

const SLACK_MANIFEST = `display_information:
  name: OpenClaw Bot
  description: Your AI assistant
  background_color: "#e64a19"
features:
  bot_user:
    display_name: OpenClaw
    always_online: true
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - files:read
      - files:write
      - groups:history
      - groups:read
      - im:history
      - im:read
      - im:write
      - mpim:history
      - mpim:read
      - mpim:write
      - reactions:read
      - reactions:write
      - users:read
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
      - message.groups
      - message.im
      - message.mpim
  interactivity:
    is_enabled: false
  org_deploy_enabled: false
  socket_mode_enabled: true
`;

interface QuickstartOptions {
  scenario?: "local" | "cloud" | "slack" | "node";
  nonInteractive?: boolean;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(`${question} (y/n): `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

function printBanner(title: string) {
  console.log("\n" + "=".repeat(50));
  console.log(`  🦞 ${title}`);
  console.log("=".repeat(50) + "\n");
}

function printStep(step: number, total: number, description: string) {
  console.log(`\n[${step}/${total}] ${description}`);
  console.log("-".repeat(40));
}

async function setupLocal(runtime: RuntimeEnv): Promise<void> {
  printBanner("Local Setup - All-in-One");

  console.log("This will set up OpenClaw to run entirely on this machine.");
  console.log("Perfect for personal use and development.\n");

  const steps = [
    "Check prerequisites",
    "Configure AI provider",
    "Initialize workspace",
    "Start gateway",
  ];

  // Step 1: Prerequisites
  printStep(1, steps.length, steps[0]);
  console.log("✓ Node.js detected");

  // Step 2: AI Provider
  printStep(2, steps.length, steps[1]);
  console.log("\nChoose your AI provider:\n");
  console.log("  1. Anthropic (Claude) - recommended");
  console.log("  2. OpenAI (GPT-4)");
  console.log("  3. GitHub Copilot (if you have access)");
  console.log("  4. Skip (configure later)\n");

  const choice = await prompt("Enter choice (1-4): ");

  if (choice === "1") {
    console.log("\nSet your Anthropic API key:");
    console.log("  export ANTHROPIC_API_KEY='your-key-here'");
    console.log("\nOr run the full onboarding wizard:");
    console.log("  openclaw onboard\n");
  } else if (choice === "2") {
    console.log("\nSet your OpenAI API key:");
    console.log("  export OPENAI_API_KEY='your-key-here'");
    console.log("\nThen configure OpenClaw:");
    console.log("  openclaw config set agents.defaults.provider openai");
    console.log("  openclaw config set agents.defaults.model gpt-4o\n");
  } else if (choice === "3") {
    console.log("\nFor GitHub Copilot, run:");
    console.log("  openclaw onboard --auth-choice github-copilot\n");
  }

  // Step 3: Workspace
  printStep(3, steps.length, steps[2]);
  const workspaceDir = path.join(resolveStateDir(), "workspace");
  await fs.mkdir(workspaceDir, { recursive: true });
  console.log(`✓ Workspace ready at: ${workspaceDir}`);

  // Step 4: Start gateway
  printStep(4, steps.length, steps[3]);
  console.log("\nTo start the gateway, run:");
  console.log("  openclaw gateway run\n");
  console.log("Or for the interactive TUI:");
  console.log("  openclaw tui\n");

  console.log("✅ Local setup complete!\n");
}

async function setupCloud(runtime: RuntimeEnv): Promise<void> {
  printBanner("Cloud Gateway Setup");

  console.log("This will help you deploy a gateway to AWS that's always available.");
  console.log("Your Mac will connect as a node for terminal access.\n");

  const hasAws = await checkCommand("aws");
  if (!hasAws) {
    console.log("❌ AWS CLI not found.");
    console.log("\nInstall it first:");
    console.log("  brew install awscli");
    console.log("  aws configure\n");
    return;
  }

  console.log("✓ AWS CLI found\n");

  // Check for SSH key
  const keyName = await prompt("Enter your AWS SSH key pair name (or 'create' to make one): ");

  if (keyName.toLowerCase() === "create") {
    console.log("\nCreating SSH key pair...");
    const newKeyName = "openclaw-" + Date.now();
    const keyPath = path.join(process.env.HOME || "~", ".ssh", `${newKeyName}.pem`);

    const result = spawn("aws", [
      "ec2",
      "create-key-pair",
      "--key-name",
      newKeyName,
      "--query",
      "KeyMaterial",
      "--output",
      "text",
    ]);

    let keyMaterial = "";
    result.stdout.on("data", (data) => {
      keyMaterial += data;
    });

    await new Promise<void>((resolve) => result.on("close", resolve));

    if (keyMaterial) {
      await fs.writeFile(keyPath, keyMaterial, { mode: 0o400 });
      console.log(`✓ Key saved to: ${keyPath}`);
      console.log(`  Key name: ${newKeyName}\n`);
    }
  }

  console.log("\nTo deploy to AWS, run:");
  console.log(`  ./scripts/deploy-aws.sh --key-name ${keyName || "YOUR_KEY"}\n`);

  console.log("After deployment, connect your Mac as a node:");
  console.log("  openclaw quickstart node\n");
}

async function setupSlack(runtime: RuntimeEnv): Promise<void> {
  printBanner("Slack Integration Setup");

  console.log("This will guide you through setting up a Slack bot.\n");

  const steps = [
    "Create Slack app",
    "Enable Socket Mode",
    "Get tokens",
    "Configure OpenClaw",
    "Test connection",
  ];

  // Step 1
  printStep(1, steps.length, steps[0]);
  console.log("1. Go to: https://api.slack.com/apps");
  console.log("2. Click 'Create New App' → 'From an app manifest'");
  console.log("3. Select your workspace");
  console.log("4. Paste this YAML manifest:\n");
  console.log("---");
  console.log(SLACK_MANIFEST);
  console.log("---\n");

  await prompt("Press Enter when you've created the app...");

  // Step 2
  printStep(2, steps.length, steps[1]);
  console.log("In your Slack app settings:");
  console.log("1. Go to 'Socket Mode' in the sidebar");
  console.log("2. Toggle 'Enable Socket Mode' ON");
  console.log("3. Create an app-level token with 'connections:write' scope");
  console.log("4. Copy the token (starts with xapp-)\n");

  const appToken = await prompt("Paste your App Token (xapp-...): ");

  // Step 3
  printStep(3, steps.length, steps[2]);
  console.log("Now get your Bot Token:");
  console.log("1. Go to 'OAuth & Permissions' in the sidebar");
  console.log("2. Click 'Install to Workspace'");
  console.log("3. Copy the 'Bot User OAuth Token' (starts with xoxb-)\n");

  const botToken = await prompt("Paste your Bot Token (xoxb-...): ");

  // Step 4
  printStep(4, steps.length, steps[3]);
  
  console.log("Add these tokens to your config. Run:");
  console.log(`  openclaw channels add --channel slack --app-token "${appToken}" --bot-token "${botToken}"`);
  console.log("\nOr add to ~/.openclaw/openclaw.json:");
  console.log(`  {
    "channels": {
      "slack": {
        "enabled": true,
        "appToken": "${appToken}",
        "botToken": "${botToken}"
      }
    }
  }`);
  console.log("");

  // Step 5
  printStep(5, steps.length, steps[4]);
  console.log("Restart your gateway to apply changes:");
  console.log("  openclaw gateway restart\n");

  console.log("Then test by messaging your bot in Slack!\n");

  console.log("✅ Slack setup complete!\n");
}

async function setupNode(runtime: RuntimeEnv): Promise<void> {
  printBanner("Node Setup - Connect Mac to Remote Gateway");

  console.log("This will configure your Mac to connect to a remote gateway.\n");

  const gatewayHost = await prompt("Enter gateway host (IP or hostname): ");
  const gatewayPort = await prompt("Enter gateway port (default 18789): ") || "18789";
  const gatewayToken = await prompt("Enter gateway token: ");

  // Show config instructions
  console.log("\n1. Configure remote mode in ~/.openclaw/openclaw.json:");
  console.log(`   {
     "gateway": {
       "mode": "remote",
       "remote": {
         "url": "ws://${gatewayHost}:${gatewayPort}",
         "token": "${gatewayToken}"
       }
     }
   }`);

  console.log("\n2. Install node service:");
  console.log(`   openclaw node install --host ${gatewayHost} --port ${gatewayPort}`);

  console.log("\nThis will:");
  console.log("  • Register this Mac with the gateway");
  console.log("  • Enable terminal access from the AI agent");
  console.log("  • Start automatically on login\n");

  console.log("✅ Node setup instructions complete!\n");
}

async function checkCommand(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("which", [cmd]);
    proc.on("close", (code) => resolve(code === 0));
  });
}

export async function quickstartCommand(
  opts: QuickstartOptions = {},
  runtime: RuntimeEnv = defaultRuntime
): Promise<void> {
  if (opts.scenario) {
    switch (opts.scenario) {
      case "local":
        await setupLocal(runtime);
        return;
      case "cloud":
        await setupCloud(runtime);
        return;
      case "slack":
        await setupSlack(runtime);
        return;
      case "node":
        await setupNode(runtime);
        return;
    }
  }

  // Interactive selection
  printBanner("OpenClaw Quick Start");

  console.log("Choose your setup scenario:\n");
  console.log("  1. Local      - Run everything on this Mac");
  console.log("  2. Cloud      - Deploy gateway to AWS (always-on)");
  console.log("  3. Slack      - Set up Slack bot integration");
  console.log("  4. Node       - Connect this Mac to a remote gateway\n");

  const choice = await prompt("Enter choice (1-4): ");

  switch (choice) {
    case "1":
      await setupLocal(runtime);
      break;
    case "2":
      await setupCloud(runtime);
      break;
    case "3":
      await setupSlack(runtime);
      break;
    case "4":
      await setupNode(runtime);
      break;
    default:
      console.log("Invalid choice. Run 'openclaw quickstart' to try again.");
  }
}
