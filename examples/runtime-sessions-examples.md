# Runtime Sessions - Practical Examples

This guide provides real-world examples of using session-scoped runtimes in agents.

## Example 1: Git Workflow

```python
# Initialize git session once
runtime.exec("git config user.name 'Agent'")
runtime.exec("git config user.email 'agent@example.com'")

# All subsequent git commands run in this context
runtime.exec("git clone https://github.com/user/repo.git")
runtime.exec("cd repo && pwd")
runtime.exec("git status")
runtime.exec("git log --oneline | head -5")

# The working directory persists
runtime.exec("echo $PWD")  # Still in repo directory
```

## Example 2: Data Science Pipeline

```python
# Setup pandas environment
runtime.exec("""
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sklearn.preprocessing import StandardScaler
""", language="python")

# Load and explore
runtime.exec("""
df = pd.read_csv('data.csv')
print(f"Shape: {df.shape}")
print(df.describe())
""", language="python")

# Clean
runtime.exec("""
df = df.dropna()
df['age'] = df['age'].astype(int)
print(f"Cleaned shape: {df.shape}")
""", language="python")

# Scale features
runtime.exec("""
scaler = StandardScaler()
features = df[['age', 'income', 'score']]
scaled = scaler.fit_transform(features)
df_scaled = pd.DataFrame(scaled, columns=features.columns)
print(df_scaled.head())
""", language="python")

# Save
runtime.exec("""
df_scaled.to_csv('processed.csv', index=False)
print("Saved to processed.csv")
""", language="python")
```

## Example 3: Multi-Language Project Build

```python
# Check environment
runtime.exec("node --version")
runtime.exec("npm --version")
runtime.exec("python --version")

# Build frontend
runtime.exec("cd frontend && npm install")
runtime.exec("npm run build")

# Build backend
runtime.exec("cd ../backend && pip install -r requirements.txt")
runtime.exec("python -m pytest tests/")

# Package
runtime.exec("cd .. && tar czf release.tar.gz frontend/dist backend/src")
runtime.exec("ls -lh release.tar.gz")
```

## Example 4: Environment Setup for Deployment

```python
# Set environment variables once
runtime.exec("""
export ENV='production'
export DB_HOST='prod-db.example.com'
export DB_NAME='production'
export API_KEY='${PROD_API_KEY}'
export LOG_LEVEL='INFO'
export DEBUG='false'
""")

# All commands now have access to these
runtime.exec("env | grep DB")
runtime.exec("python app.py")  # Reads from ENV vars
runtime.exec("curl -H \"X-API-Key: $API_KEY\" https://api.example.com/status")
```

## Example 5: Interactive System Administration

```python
# Get system info
state = runtime.state()
print(f"Working from: {state.working_dir}")

# Monitor logs
runtime.exec("tail -n 20 /var/log/app.log")

# Check processes
runtime.exec("ps aux | grep python")

# Manage services
runtime.exec("systemctl status myapp")
runtime.exec("systemctl restart myapp")
runtime.exec("systemctl status myapp")

# Verify changes
runtime.exec("curl -s http://localhost:8080/health | jq .")
```

## Example 6: Python Machine Learning Loop

```python
# Setup ML environment
runtime.exec("""
import torch
import torchvision
import numpy as np
from sklearn.metrics import accuracy_score, precision_score

# Load model
model = torch.load('model.pt')
model.eval()

# Counters
correct = 0
total = 0
""", language="python")

# Process batch 1
runtime.exec("""
# Load batch 1
batch1_data = np.load('batch1.npy')
with torch.no_grad():
    predictions = model(torch.tensor(batch1_data))
batch1_correct = (predictions > 0.5).sum().item()
print(f"Batch 1: {batch1_correct} correct predictions")
""", language="python")

# Process batch 2 (previous variables still available)
runtime.exec("""
batch2_data = np.load('batch2.npy')
with torch.no_grad():
    predictions = model(torch.tensor(batch2_data))
batch2_correct = (predictions > 0.5).sum().item()
print(f"Batch 2: {batch2_correct} correct predictions")
""", language="python")

# Aggregate results
runtime.exec("""
total_correct = batch1_correct + batch2_correct
print(f"Total correct: {total_correct}")
print(f"Accuracy: {total_correct / 200 * 100:.1f}%")
""", language="python")
```

## Example 7: Database Operations

```python
# Connect to database
runtime.exec("""
import sqlite3

conn = sqlite3.connect('database.db')
cursor = conn.cursor()
print("Connected to database")
""", language="python")

# Create table
runtime.exec("""
cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE
    )
''')
conn.commit()
print("Table created")
""", language="python")

# Insert data
runtime.exec("""
users = [
    ('Alice', 'alice@example.com'),
    ('Bob', 'bob@example.com'),
    ('Charlie', 'charlie@example.com')
]
cursor.executemany('INSERT INTO users (name, email) VALUES (?, ?)', users)
conn.commit()
print(f"Inserted {len(users)} users")
""", language="python")

# Query data
runtime.exec("""
cursor.execute('SELECT * FROM users WHERE name LIKE "A%"')
for row in cursor.fetchall():
    print(f"User: {row[1]} ({row[2]})")
""", language="python")

# Close
runtime.exec("""
cursor.close()
conn.close()
print("Closed connection")
""", language="python")
```

## Example 8: Testing with State

```python
# Setup test environment
runtime.exec("""
import unittest
import sys

class TestCalculator(unittest.TestCase):
    def setUp(self):
        self.result = None
    
    def test_add(self):
        self.result = 2 + 2
        self.assertEqual(self.result, 4)
    
    def test_multiply(self):
        self.result = 3 * 7
        self.assertEqual(self.result, 21)

# Run tests
suite = unittest.TestLoader().loadTestsFromTestCase(TestCalculator)
runner = unittest.TextTestRunner(verbosity=2)
result = runner.run(suite)
print(f"\\nTests run: {result.testsRun}")
print(f"Failures: {len(result.failures)}")
print(f"Errors: {len(result.errors)}")
""", language="python")
```

## Example 9: REST API Client with Session

```python
# Setup HTTP session
runtime.exec("""
import requests
import json
from datetime import datetime

# Create session with auth
session = requests.Session()
session.headers.update({
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json',
    'User-Agent': 'Agent/1.0'
})

base_url = 'https://jsonplaceholder.typicode.com'
print("Session created")
""", language="python")

# Create resource
runtime.exec("""
payload = {
    'title': 'New Post',
    'body': 'This is a new post created at ' + datetime.now().isoformat(),
    'userId': 1
}
response = session.post(f'{base_url}/posts', json=payload)
created_id = response.json()['id']
print(f"Created post: {created_id}")
""", language="python")

# Read resource
runtime.exec("""
response = session.get(f'{base_url}/posts/{created_id}')
post = response.json()
print(f"Retrieved: {post['title']}")
""", language="python")

# Update resource
runtime.exec("""
payload['title'] = 'Updated Title'
response = session.put(f'{base_url}/posts/{created_id}', json=payload)
print(f"Updated post: {response.json()['title']}")
""", language="python")

# Delete resource
runtime.exec("""
response = session.delete(f'{base_url}/posts/{created_id}')
print(f"Deleted post (status: {response.status_code})")
""", language="python")

# Get summary
runtime.exec("""
response = session.get(f'{base_url}/posts?userId=1')
posts = response.json()
print(f"User 1 has {len(posts)} posts")
""", language="python")
```

## Example 10: File Processing with Progress

```python
# Setup processing environment
runtime.exec("""
import os
import json
from pathlib import Path

# Configuration
input_dir = Path('input_files')
output_dir = Path('output_files')
output_dir.mkdir(exist_ok=True)

# State
total_files = 0
processed = 0
errors = 0
""", language="python")

# Process files
runtime.exec("""
for input_file in input_dir.glob('*.json'):
    total_files += 1
    try:
        with open(input_file) as f:
            data = json.load(f)
        
        # Process
        data['processed'] = True
        data['timestamp'] = datetime.now().isoformat()
        
        # Save
        output_file = output_dir / f"{input_file.stem}_processed.json"
        with open(output_file, 'w') as f:
            json.dump(data, f, indent=2)
        
        processed += 1
        print(f"✓ {input_file.name}")
    except Exception as e:
        errors += 1
        print(f"✗ {input_file.name}: {e}")

print(f"\\nTotal: {total_files} | Processed: {processed} | Errors: {errors}")
""", language="python")

# Verify results
runtime.exec("""
output_files = list(output_dir.glob('*.json'))
print(f"Output files: {len(output_files)}")
for f in output_files[:5]:
    print(f"  - {f.name} ({f.stat().st_size} bytes)")
""", language="python")
```

## Example 11: Configuration Management

```python
# Load and parse config
runtime.exec("""
import configparser
import os

config = configparser.ConfigParser()
config.read('config.ini')

# Extract and set environment
for section in config.sections():
    for key, value in config.items(section):
        env_key = f"{section.upper()}_{key.upper()}"
        os.environ[env_key] = value
        print(f"Set {env_key}")
""", language="python")

# Use configuration across commands
runtime.exec("env | grep -E '_HOST|_PORT|_DEBUG'")
runtime.exec("python start_app.py")
```

## Example 12: Parallel Task Coordination

```python
# Setup task tracking
runtime.exec("""
import threading
import time
from datetime import datetime

tasks = {
    'task1': {'status': 'pending'},
    'task2': {'status': 'pending'},
    'task3': {'status': 'pending'}
}

def log_task(name, status):
    tasks[name]['status'] = status
    tasks[name]['timestamp'] = datetime.now().isoformat()
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {name}: {status}")
""", language="python")

# Execute tasks
runtime.exec("""
log_task('task1', 'running')
time.sleep(1)
log_task('task1', 'completed')
""", language="python")

runtime.exec("""
log_task('task2', 'running')
time.sleep(0.5)
log_task('task2', 'completed')
""", language="python")

# Summary
runtime.exec("""
print("\\nTask Summary:")
for name, info in tasks.items():
    print(f"  {name}: {info['status']} at {info.get('timestamp', 'N/A')}")
""", language="python")
```

## Tips for Effective Use

### 1. Check State Before Assumptions

```python
state = runtime.state()
if 'mylib' not in state.imports:
    runtime.exec("import mylib", language="python")
```

### 2. Error Checking

```python
result = runtime.exec("command")
if result.exit_code != 0:
    print(f"Error: {result.stderr}")
else:
    print("Success!")
```

### 3. Inspect History

```python
# See what's been executed
history = runtime.getHistory(5)
for entry in history:
    print(f"{entry['command']} took {entry['duration']}ms")
```

### 4. Clean Between Major Tasks

```python
# Reset when moving to a different task
runtime.reset()

# Now start fresh with new environment
runtime.exec("export TASK_ID=new_task")
```

### 5. Set Up Once, Use Many Times

```python
# Setup (expensive, one-time)
runtime.exec("pip install -r requirements.txt", language="python")
runtime.exec("import torch; model = load_model('large.pt')", language="python")

# Use (cheap, many times)
for data_file in data_files:
    runtime.exec(f"result = model.predict(load_data('{data_file}'))")
```

## Performance Benchmarks

```
Operation                  | Time
---------------------------|--------
Create session (cold start) | ~150ms
Execute bash command        | ~20ms
Execute Python code         | ~30ms
Import library              | ~50ms (first time only)
Get state                   | ~10ms
Reset session               | ~5ms
```

Compared to standard `exec`:
- **Single command**: Standard exec is faster (no startup overhead)
- **10+ commands**: Runtime session is 5-10x faster
- **100+ commands**: Runtime session is 20-50x faster
