# Runtime Sessions - Agent Integration Guide

This guide explains how to integrate session-scoped runtimes into your agents.

## What Is It?

Session-scoped runtimes are persistent bash/python environments that maintain state across multiple tool calls:

```
Standard exec:              Runtime session:
┌─────────────┐            ┌─────────────┐
│ call 1      │ → fresh    │ call 1      │ → process 1
│ echo $VAR   │   shell    │ VAR="hello" │   bash running
└─────────────┘            └─────────────┘
                           ┌─────────────┐
┌─────────────┐            │ call 2      │ → same process
│ call 2      │ → fresh    │ echo $VAR   │   VAR still in
│ echo $VAR   │   shell    │ (outputs    │   environment
│ (outputs    │   (no VAR) │ hello)      │
│ nothing)    │            └─────────────┘
└─────────────┘
```

## Key Differences from Standard `exec` Tool

| Aspect | Standard `exec` | Runtime Session |
|--------|---|---|
| **Process lifecycle** | Fresh shell per call | Single process for 30 min |
| **Variable persistence** | ❌ Lost between calls | ✅ Variables persist |
| **Working directory** | Reset to start | Current directory persists |
| **Imports (Python)** | Reloaded each time | Cached across calls |
| **Environment variables** | Reset | Set once, reuse |
| **Use case** | Quick one-off commands | Multi-step workflows |
| **Performance** | Simple | Better for 10+ operations |

## When to Use Runtime vs Exec

### Use **runtime** when:

```python
✅ Multiple bash commands in sequence
✅ Python with expensive imports (numpy, pandas, torch)
✅ Multi-step Git workflows
✅ Environment variables that apply to many commands
✅ Database operations (connection reuse)
✅ API clients with persistent sessions
✅ Building/deploying (multiple build steps)
✅ Data processing pipelines
```

### Use **exec** when:

```python
✅ Single one-off command
✅ Simple file operations
✅ Quick system checks
✅ Commands that don't need prior state
✅ Untrusted code (better isolation)
✅ Different workspaces (need fresh env)
```

## Tool Schema

The `runtime` tool is automatically added to all agents. Its interface:

```typescript
{
  name: "runtime",
  description: "Session-scoped persistent runtime for bash/python",
  input_schema: {
    properties: {
      action: {
        type: "string",
        enum: ["exec", "eval", "state", "reset", "history"],
        description: "Action to perform"
      },
      command: {
        type: "string",
        description: "Command/code to execute (for exec/eval)"
      },
      language: {
        type: "string",
        enum: ["bash", "python", "node"],
        description: "Runtime language (default: bash for exec, python for eval)"
      },
      limit: {
        type: "number",
        description: "Limit for history action"
      }
    }
  }
}
```

## Code Examples

### Example 1: Bash Workflow

```python
# Agent code calling runtime tool

# Step 1: Navigate to repository
result = await agent.call_tool("runtime", {
    "action": "exec",
    "command": "cd /home/projects/myrepo && pwd",
    "language": "bash"
})
print("Working dir:", result.stdout)

# Step 2: Check git status (current directory persists!)
result = await agent.call_tool("runtime", {
    "action": "exec",
    "command": "git status",
    "language": "bash"
})
print("Git status:", result.stdout)

# Step 3: Create and checkout branch
result = await agent.call_tool("runtime", {
    "action": "exec",
    "command": "git checkout -b feature/new-feature",
    "language": "bash"
})
```

### Example 2: Python with Imports

```python
# Setup imports once
await agent.call_tool("runtime", {
    "action": "exec",
    "command": """
import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
""",
    "language": "python"
})

# Load data
await agent.call_tool("runtime", {
    "action": "exec",
    "command": """
df = pd.read_csv('data.csv')
print(f"Shape: {df.shape}")
print(df.head())
""",
    "language": "python"
})

# Process (pandas already imported and in memory)
await agent.call_tool("runtime", {
    "action": "exec",
    "command": """
scaler = StandardScaler()
scaled = scaler.fit_transform(df)
print(f"Scaled shape: {scaled.shape}")
""",
    "language": "python"
})
```

### Example 3: Inspect State

```python
# Check what's in the session
result = await agent.call_tool("runtime", {
    "action": "state"
})

state = json.loads(result.content)
print(f"Current directory: {state.state.working_dir}")
print(f"Python imports: {state.state.imports}")
print(f"Environment vars: {state.state.env_vars}")
print(f"Command history: {len(state.state.history)} commands executed")
```

### Example 4: Error Handling

```python
# Always check if command succeeded
result = await agent.call_tool("runtime", {
    "action": "exec",
    "command": "risky_command",
    "language": "bash"
})

content = json.loads(result.content)

if not content.success:
    print(f"Command failed: {content.error}")
    print(f"Stderr: {content.stderr}")
else:
    print(f"Output: {content.stdout}")
    print(f"Exit code: {content.exitCode}")
```

### Example 5: Reset and Start Fresh

```python
# Do some work
await agent.call_tool("runtime", {
    "action": "exec",
    "command": "export TEMP_VAR=temp_value",
    "language": "bash"
})

# ... more work ...

# Reset when moving to different task
await agent.call_tool("runtime", {
    "action": "reset"
})

# Now starting fresh (no TEMP_VAR, clean environment)
result = await agent.call_tool("runtime", {
    "action": "exec",
    "command": "echo $TEMP_VAR",  # Will be empty
    "language": "bash"
})
```

## Implementation in Agent Code

### TypeScript/JavaScript

```typescript
import { createOpenClawCodingTools } from "./agents/pi-tools.js";

// Get tools including runtime
const tools = createOpenClawCodingTools({
  workspaceDir: "/home/user/workspace",
  sessionKey: "agent:main:session:123",
  // ... other options
});

// Runtime tool is automatically included!
// Use it like any other tool:
const runtimeTool = tools.find((t) => t.name === "runtime");

if (runtimeTool) {
  const result = await runtimeTool.call({
    action: "exec",
    command: "echo 'Hello from runtime'",
    language: "bash",
  });
  console.log(result.content);
}
```

### Working with Agents

```typescript
// In your agent/conversation handler

import type { AgentTool } from "@mariozechner/pi-agent-core";

async function runAgentWithRuntime(prompt: string) {
  const tools = createOpenClawCodingTools({
    workspaceDir: process.cwd(),
  });

  // Agent will automatically use runtime tool when needed
  // Example: "Set a variable and use it across commands"
  const response = await agent.run({
    messages: [{ role: "user", content: prompt }],
    tools,
  });

  return response;
}

// Usage:
await runAgentWithRuntime(`
  1. Create a bash variable VAR with value "hello"
  2. In a separate command, print the value of VAR
  3. Show me what's in the session state
`);
```

## Session Management

### Per-Workspace Isolation

Each workspace gets its own isolated runtime session:

```typescript
// Workspace 1 gets its own session
const tools1 = createOpenClawCodingTools({
  workspaceDir: "/home/user/project1",
});

// Workspace 2 gets its own session
const tools2 = createOpenClawCodingTools({
  workspaceDir: "/home/user/project2",
});

// They don't interfere with each other!
```

### Session Timeout

Sessions automatically terminate after 30 minutes of inactivity:

```typescript
// If your agent is idle for 30 minutes,
// the session will be cleaned up automatically

// After timeout, next call starts fresh
// (Variables are lost, process is restarted)
```

### Manual Cleanup

```typescript
import { globalRuntimeManager } from "./runtime-sessions/runtime-manager.js";

// Terminate a specific session
await globalRuntimeManager.terminateSession("workspace-id");

// Terminate all sessions
await globalRuntimeManager.terminateAll();
```

## Configuration

### Timeout Duration

```typescript
import { globalRuntimeManager } from "./runtime-sessions/runtime-manager.js";

// Create session with custom timeout
const session = globalRuntimeManager.getOrCreateSession(
  "my-workspace",
  {
    timeoutMs: 5 * 60 * 1000, // 5 minutes instead of default 30
  }
);
```

### History Size

```typescript
const session = globalRuntimeManager.getOrCreateSession(
  "my-workspace",
  {
    maxHistorySize: 200, // Keep last 200 commands instead of 100
  }
);
```

## Best Practices

### 1. Group Related Commands

```python
# ✅ Good: Multiple related commands
await runtime.call({
  "action": "exec",
  "command": """
cd /project
git status
git add .
git commit -m "Changes"
""",
  "language": "bash"
})

# ❌ Avoid: Single commands in loop
for cmd in ["git status", "git add .", "git commit -m 'Changes'"]:
    await runtime.call({"action": "exec", "command": cmd})
```

### 2. Check Prerequisites

```python
# ✅ Check state before assuming
state = await runtime.call({"action": "state"})
if "requests" not in state.imports:
    await runtime.call({
        "action": "exec",
        "command": "pip install requests",
        "language": "python"
    })
```

### 3. Handle Errors Gracefully

```python
# ✅ Check for errors
result = await runtime.call({
    "action": "exec",
    "command": cmd,
    "language": "bash"
})

if not result.success:
    print(f"Error: {result.error}")
    return None
else:
    return result.stdout
```

### 4. Use Reset for Task Boundaries

```python
# ✅ Reset between unrelated tasks
await runtime.call({"action": "reset"})

# Now clean environment for new task
await runtime.call({
    "action": "exec",
    "command": "export NEW_TASK_ID=task123"
})
```

### 5. Leverage Caching

```python
# ✅ Heavy operation (one-time)
await runtime.call({
    "action": "exec",
    "command": "import torch; model = load_model('large.pt')",
    "language": "python"
})

# ✅ Light operations (many times, uses cached model)
for data_file in large_list:
    await runtime.call({
        "action": "exec",
        "command": f"predict(model, '{data_file}')",
        "language": "python"
    })
```

## Debugging

### View Command History

```python
result = await runtime.call({
    "action": "history",
    "limit": 10
})

history = json.loads(result.content).history
for entry in history:
    print(f"{entry.command} ({entry.duration}ms)")
```

### Inspect Session State

```python
result = await runtime.call({"action": "state"})
state = json.loads(result.content).state

print("Environment:", state.env_vars)
print("Imports:", state.imports)
print("Working dir:", state.working_dir)
print("Recent history:", state.history[-3:])
```

### Check Session Status

```typescript
import { globalRuntimeManager } from "./runtime-sessions/runtime-manager.js";

const session = globalRuntimeManager.getSession("workspace-id");
if (session) {
  const state = await session.state();
  console.log("Session is alive");
  console.log("Last activity:", session.getLastActivityTime());
} else {
  console.log("Session does not exist or has timed out");
}
```

## Performance Tips

### Startup Cost

```python
# First call: ~150-200ms (process startup)
# Subsequent calls: ~20-50ms (direct execution)
```

### Batch Operations

```python
# ✅ Good: Process 1000 items in a loop (in one call)
await runtime.call({
    "action": "exec",
    "command": """
for i in range(1000):
    process_item(i)
""",
    "language": "python"
})

# ❌ Avoid: 1000 separate calls (unnecessary overhead)
for i in range(1000):
    await runtime.call({
        "action": "exec",
        "command": f"process_item({i})"
    })
```

### Import Caching

```python
# Expensive imports only happen once
await runtime.call({
    "action": "exec",
    "command": "import torch; import tensorflow as tf",
    "language": "python"
})

# Subsequent uses are instant
await runtime.call({
    "action": "exec",
    "command": "model = tf.keras.models.load_model('model.h5')",
    "language": "python"
})
```

## Troubleshooting

### Session Not Available

```
Error: Session has been terminated

→ Session timed out (30 min inactivity)
→ Was explicitly terminated
→ Process crashed

Solution: Call will create new session
```

### Variable Not Persisting

```
Expected: echo $VAR → outputs "value"
Actual: (empty)

Possible causes:
- Different workspace ID
- Session timed out
- Variable wasn't set correctly

Debug:
```python
state = await runtime.call({"action": "state"})
print(state.env_vars)  # Check if VAR is there
```

### Import Not Found

```
Python error: ModuleNotFoundError: No module named 'torch'

Causes:
- Not installed in Python environment
- Typo in import statement
- Different workspace (need to pip install again)

Solution:
```python
await runtime.call({
    "action": "exec",
    "command": "pip install torch",
    "language": "python"
})
```

## Migration from Standard Exec

### Before (Standard Exec)

```python
# Each call starts fresh - VAR is lost
await agent.call_tool("exec", {"command": "export VAR='hello'"})
result = await agent.call_tool("exec", {"command": "echo $VAR"})
# Output: (empty)
```

### After (Runtime Session)

```python
# Use runtime instead - VAR persists
await agent.call_tool("runtime", {
    "action": "exec",
    "command": "export VAR='hello'",
    "language": "bash"
})

result = await agent.call_tool("runtime", {
    "action": "exec",
    "command": "echo $VAR",
    "language": "bash"
})
# Output: "hello"
```

## Further Reading

- [Runtime Sessions Documentation](./runtime-sessions.md)
- [Examples](../examples/runtime-sessions-examples.md)
- [Source Code](../src/runtime-sessions/)
