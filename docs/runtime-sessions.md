# Session-Scoped Runtime (REPL-style)

A persistent, session-based runtime system for agents that keeps bash and Python environments alive across multiple tool calls. Perfect for tasks requiring stateful command execution, persistent variables, and library imports.

## Overview

Traditional `exec` tools start a fresh shell for each command, losing all context. **Session-scoped runtimes** maintain long-lived shell and Python processes with:

- **Persistent variables**: Set `VAR='hello'` once, use it in subsequent calls
- **Persistent imports**: Import a library once, reuse it across calls
- **Working directory tracking**: `cd` commands persist to the next execution
- **Command history**: Full audit trail of all commands executed
- **Automatic cleanup**: Sessions timeout after 30 minutes of inactivity
- **Per-workspace isolation**: Each workspace gets its own isolated session

## Quick Start

### Basic Bash Execution

```python
# Set a variable in the session
runtime.exec("VAR='hello world'")

# Use the variable in a subsequent call - VAR persists!
result = runtime.exec("echo $VAR")
print(result.stdout)  # Output: "hello world"
```

### Python with Persistent Imports

```python
# Import a library once
runtime.exec("import pandas as pd", language="python")

# Load some data
runtime.exec("""
df = pd.read_csv('data.csv')
print(f"Loaded {len(df)} rows")
""", language="python")

# Use the dataframe in another call - df is still in memory!
result = runtime.exec("print(df.columns)", language="python")
```

### Inspect Session State

```python
# Get current environment variables, imports, working directory
state = runtime.state()

print("Environment:", state.env_vars)
print("Python imports:", state.imports)
print("Working dir:", state.working_dir)
print("Recent commands:", state.history[-5:])
```

## Tool Reference

### Actions

#### `runtime.exec(command, language="bash")`

Execute a command in the persistent runtime.

**Parameters:**
- `command` (string, required): The command/code to execute
- `language` (string, optional): "bash" (default), "python", or "node"
- `timeout` (number, optional): Timeout in milliseconds (default: 30000)

**Returns:**
```json
{
  "success": true,
  "stdout": "command output",
  "stderr": "",
  "exitCode": 0
}
```

**Examples:**

```python
# Bash example
result = runtime.exec("ls -la /home", language="bash")

# Python example with multi-line code
result = runtime.exec("""
import os
files = os.listdir('.')
for f in files[:5]:
    print(f)
""", language="python")
```

#### `runtime.eval(code, language="python")`

Evaluate code inline. Alias for `exec` with Python as default.

**Parameters:**
- `code` (string, required): Python code to evaluate
- `language` (string, optional): Currently only "python" is supported

**Returns:** Same as `exec`

**Examples:**

```python
result = runtime.eval("x = 42; print(x * 2)")
# Output: "84"
```

#### `runtime.state()`

Inspect the current session state.

**Returns:**
```json
{
  "success": true,
  "state": {
    "env_vars": {
      "HOME": "/home/user",
      "CUSTOM_VAR": "value"
    },
    "functions": [],
    "imports": ["os", "sys", "json"],
    "working_dir": "/home/user/projects",
    "history": [
      {
        "timestamp": 1702000000000,
        "command": "VAR='hello'",
        "language": "bash",
        "duration": 45
      }
    ]
  }
}
```

#### `runtime.reset()`

Clear all session state (environment variables, variables, imports, history).

**Parameters:** None

**Returns:**
```json
{
  "success": true,
  "stdout": "Session reset successfully"
}
```

**Use cases:**
- Starting fresh without creating a new session
- Cleaning up temporary variables
- Resetting working directory to initial state

#### `runtime.history(limit=20)`

Get recent command history.

**Parameters:**
- `limit` (number, optional): Number of recent entries to return (default: 20)

**Returns:**
```json
{
  "success": true,
  "history": [
    {
      "timestamp": 1702000000000,
      "command": "echo 'hello'",
      "language": "bash",
      "duration": 23
    },
    {
      "timestamp": 1702000000100,
      "command": "VAR=$?",
      "language": "bash",
      "duration": 12
    }
  ]
}
```

## Use Cases

### 1. Data Processing Pipeline

```python
# Import once
runtime.exec("import pandas as pd; import numpy as np", language="python")

# Load data
runtime.exec("df = pd.read_csv('input.csv')", language="python")

# Transform
runtime.exec("df['processed'] = df['raw'].apply(lambda x: x.strip())", language="python")

# Validate
runtime.exec("print(f'Missing values: {df.isnull().sum().sum()}')", language="python")

# Save
runtime.exec("df.to_csv('output.csv', index=False)", language="python")
```

### 2. Complex Shell Operations

```python
# Set working directory once
runtime.exec("cd /project && pwd")

# All subsequent commands run in /project
runtime.exec("git status")
runtime.exec("npm test")
runtime.exec("npm build")
```

### 3. API Client with Session

```python
# Create a session-persistent client
runtime.exec("""
import requests
session = requests.Session()
session.headers.update({'Authorization': f'Bearer {token}'})
""", language="python")

# Reuse the session across calls
runtime.exec("response = session.get('https://api.example.com/users')")
runtime.exec("users = response.json(); print(f'Got {len(users)} users')")
runtime.exec("for user in users[:5]: print(user['name'])")
```

### 4. Environment Setup

```python
# Set environment variables once
runtime.exec("export DATABASE_URL='postgresql://localhost/mydb'")
runtime.exec("export API_KEY='secret123'")
runtime.exec("export LOG_LEVEL='DEBUG'")

# All subsequent commands can access these
runtime.exec("python app.py")  # app.py reads env vars
```

## Architecture

### Components

```
RuntimeSessionManager (global singleton)
  ↓
  ├─ RuntimeSession (per workspace)
  │  ├─ ShellSession (bash process)
  │  ├─ PythonSession (python process)
  │  └─ CommandHistory + StateTracking
  └─ Session Timeout & Cleanup
```

### Session Lifecycle

1. **Create**: First `runtime.exec()` call creates a session
2. **Reuse**: Subsequent calls to the same workspace reuse the session
3. **Track**: Each command is recorded in history
4. **Timeout**: Session auto-terminates after 30 minutes of inactivity
5. **Cleanup**: Resources released, session can be recreated

## Implementation Details

### Shell Session (bash)

- **Process**: Long-lived bash `-i` (interactive) shell
- **State**: Environment variables (`export VAR=value`)
- **Tracking**: Working directory changes
- **Isolation**: Each workspace has separate process
- **Timeout**: Sends `exit` command on termination

### Python Session

- **Process**: Long-lived python `-i` (interactive) interpreter
- **State**: Variables, functions, imported modules
- **Tracking**: Import statements extracted from code
- **Globals**: All variables/functions remain in Python globals
- **Timeout**: Sends `exit()` command on termination

### Command Execution

```
Input:  "echo $VAR"
        ↓
Wrap:   "echo $VAR; echo "__SHELL_CMD_1_ERR__|$?"; echo "__SHELL_CMD_1_END__""
        ↓
Send:   Write to shell stdin
        ↓
Read:   Listen for marker in stdout
        ↓
Output: Extract and return stdout/stderr/exitCode
```

### Timeout Mechanism

- **Check interval**: Every 5 seconds
- **Timeout**: 30 minutes (configurable)
- **Reset**: Activity time updated on each `exec`
- **Grace period**: Up to 2 seconds for graceful shutdown

## Configuration

### Session Config

```typescript
interface SessionConfig {
  workspaceId: string;          // Unique workspace identifier
  timeoutMs?: number;            // Timeout after this ms (default: 1.8M)
  maxHistorySize?: number;       // Max history entries (default: 100)
}
```

### Example: Create with Custom Timeout

```typescript
const session = globalRuntimeManager.getOrCreateSession(
  "my-workspace",
  { timeoutMs: 5 * 60 * 1000 }  // 5 minutes
);
```

## Best Practices

### 1. Error Handling

```python
result = runtime.exec("risky_command")
if not result.success:
    print(f"Error: {result.error}")
else:
    print(result.stdout)
```

### 2. Long-Running Operations

```python
# Set timeout for long operations
runtime.exec(
    "time python analyze.py",
    timeout=120000  # 2 minutes
)
```

### 3. State Inspection

```python
# Check state before making assumptions
state = runtime.state()
print(f"Current directory: {state.working_dir}")
print(f"Available imports: {state.imports}")
```

### 4. Clean Resource Usage

```python
# Reset when done with a major operation
runtime.reset()

# Or let automatic timeout handle cleanup
# (30 minutes of inactivity)
```

### 5. Isolation Between Tasks

```python
# Each workspace is isolated
task1_session = globalRuntimeManager.getOrCreateSession("task-1")
task2_session = globalRuntimeManager.getOrCreateSession("task-2")

# They don't interfere with each other
```

## Troubleshooting

### Session Not Persisting Variables

**Issue:** Variables set in one call aren't available in the next.

**Cause:** Using different workspace IDs or session was terminated.

**Solution:**
```python
# Verify workspace ID is consistent
state = runtime.state()
print(f"Session ID: {state.working_dir}")

# Check if session timed out (30 min inactivity)
# Recreate if needed - data will be lost
```

### Timeout Too Short

**Issue:** Session times out while still working.

**Cause:** Default 30-minute timeout or inactivity window.

**Solution:**
```python
# Create session with longer timeout
const session = globalRuntimeManager.getOrCreateSession(
  "long-job",
  { timeoutMs: 2 * 60 * 60 * 1000 }  // 2 hours
);
```

### Import Not Tracked

**Issue:** `runtime.state().imports` doesn't show imported module.

**Cause:** Import statement wasn't recognized by regex.

**Solution:**
```python
# Use standard import syntax
runtime.exec("import json", language="python")
runtime.exec("from pathlib import Path", language="python")

# Verify with state
state = runtime.state()
print(state.imports)  # Should show ['json', 'Path']
```

### Python Process Dies Unexpectedly

**Issue:** Python session crashes or becomes unresponsive.

**Cause:** Infinite loop, segfault, or out-of-memory.

**Solution:**
```python
# Reset will kill and restart the process
await runtime.reset()

# Or terminate entire session
await globalRuntimeManager.terminateSession("workspace-id")
```

## Security Considerations

### 1. Session Isolation

- Each workspace has **separate bash/python processes**
- Environment variables don't leak between workspaces
- No inter-process communication

### 2. Resource Limits

- **Per-command timeout**: 30 seconds (configurable)
- **Per-session history**: 100 entries (configurable)
- **Automatic cleanup**: Unused sessions terminate after 30 minutes

### 3. Process Lifecycle

- Bash/Python **not started until first use**
- Graceful shutdown on timeout or explicit `terminate()`
- Signal handling: `SIGTERM` (2s) → `SIGKILL`

## Performance Notes

### Overhead Reduction

- **First call**: ~150-200ms (process startup)
- **Subsequent calls**: ~20-50ms (direct execution)
- **vs fresh shell**: ~2-5x faster for repeated operations

### Memory Usage

- **Bash session**: ~5-10MB
- **Python session**: ~20-40MB (depends on imports/data)
- **Per-workspace overhead**: ~30-50MB (both runtimes)

### Optimization Tips

```python
# Good: Batch operations
runtime.exec("""
for i in range(1000):
    process_item(i)
""", language="python")

# Avoid: Individual calls in a loop
for i in range(1000):
    runtime.exec(f"process_item({i})")  # 1000 subprocess overhead
```

## Comparison with Standard Exec

| Feature | Standard Exec | Runtime Session |
|---------|---------------|-----------------|
| Process lifetime | Per-call | Per-session (30min) |
| Variable persistence | ❌ No | ✅ Yes |
| Import persistence | ❌ No | ✅ Yes |
| Working directory | Reset each time | ✅ Persists |
| History | ❌ No | ✅ Full audit trail |
| Overhead | Per-command | Once per session |
| Use case | One-off commands | Stateful workflows |

## API Reference

See `src/agents/runtime-tool.ts` for implementation.

### TypeScript Usage

```typescript
import { createRuntimeTool } from "./agents/runtime-tool.js";
import { globalRuntimeManager } from "./runtime-sessions/runtime-manager.js";

// Create tool for agent
const tool = createRuntimeTool("workspace-id");

// Or access session directly
const session = globalRuntimeManager.getOrCreateSession("workspace-id");
const result = await session.exec({
  command: "echo hello",
  language: "bash"
});
```

## Future Enhancements

- [ ] Node.js runtime support
- [ ] Interactive REPL (blocking read for user input)
- [ ] Environment variable snapshots/restore
- [ ] Process resource limits (memory, CPU)
- [ ] Session migration between hosts
- [ ] Concurrent command execution (queue)
- [ ] Command retry with exponential backoff

## Contributing

Runtime session code is located in:
- `src/runtime-sessions/runtime-manager.ts` - Core session manager
- `src/runtime-sessions/shell-session.ts` - Bash session implementation
- `src/runtime-sessions/python-session.ts` - Python session implementation
- `src/agents/runtime-tool.ts` - Agent tool interface

Tests:
- `src/runtime-sessions/runtime-manager.test.ts`
- `src/agents/runtime-tool.test.ts`
