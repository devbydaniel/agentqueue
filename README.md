# AgentQueue

A job queue engine for AI coding agents. Accepts work via REST API, cron schedules, or webhooks, queues it through BullMQ, and delegates execution to [`af exec`](https://github.com/devbydaniel/agentfiles) with per-target locking to prevent concurrent runs on the same repository.

## Architecture

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Manual POST │   │  Cron Timer  │   │   Webhook    │
│  /jobs       │   │  (BullMQ)    │   │  /webhooks/* │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                   ┌──────▼──────┐
                   │  BullMQ     │
                   │  agent-jobs │
                   └──────┬──────┘
                          │
                   ┌──────▼──────┐
                   │  Processor  │──── Redis Lock (per target)
                   └──────┬──────┘
                          │
                   ┌──────▼──────┐
                   │   af exec   │
                   │             │
                   └─────────────┘
```

**Key components:**

- **Jobs module** — BullMQ queue + processor. The processor acquires a Redis lock per target (via Lua script for atomicity), spawns `af exec <target> -- --mode json -p <prompt>`, and releases the lock when done. Retries with exponential backoff on lock contention.
- **Manual trigger** — REST controller at `POST /jobs` for ad-hoc job submission.
- **Cron trigger** — Reads `triggers.yaml`, registers BullMQ repeatable jobs on startup.
- **Webhook trigger** — Receives webhooks at `POST /webhooks/:source`, verifies HMAC signatures (GitHub), renders Handlebars templates for target/prompt, enqueues matching jobs.
- **Bull Board** — Dashboard at `/admin/queues` for monitoring.

## Prerequisites

- **Node.js** 20+
- **Redis** 7+
- **[agentfiles](https://github.com/devbydaniel/agentfiles)** (`af`) CLI installed and on PATH
- Agent CLIs (`pi`, `claude`, etc.) installed as needed

## Setup

### 1. Install Redis

Redis must be running locally:

```bash
# Debian/Ubuntu
sudo apt install redis-server
sudo systemctl enable --now redis-server

# macOS
brew install redis
brew services start redis

# Or via Docker
docker compose up -d
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `WORKER_CONCURRENCY` | `3` | Max concurrent agent jobs |
| `JOB_TIMEOUT` | `600000` | Job timeout in ms (10 min) |
| `LOCK_TTL` | `900` | Per-target Redis lock TTL in seconds |
| `BEFORE_HOOK_TIMEOUT` | `30000` | Before hook timeout in ms (30 sec) |
| `GITHUB_WEBHOOK_SECRET` | — | HMAC secret for GitHub webhook verification |
| `TRIGGERS_CONFIG_PATH` | `./config/triggers.yaml` | Path to trigger definitions |
| `AQ_URL` | `http://localhost:3000` | AgentQueue server URL (used by `aq` CLI) |

**Important:** Set `TRIGGERS_CONFIG_PATH` to an absolute path outside the repo for production use (e.g. `~/.config/agentqueue/triggers.yml`). The default `./config/triggers.yaml` is relative to the working directory and meant as an example.

### 3. Configure triggers

Create a triggers file at the path specified by `TRIGGERS_CONFIG_PATH`:

```yaml
triggers:
  # Cron: runs on a schedule
  - name: morning-kickoff
    type: cron
    schedule: "0 8 * * 1-5"
    target: assistant
    prompt: "Run the morning kickoff routine"

  # Cron with before hook: gate + enrich
  - name: meeting-prep
    type: cron
    schedule: "*/30 8-17 * * 1-5"
    target: assistant
    before: "/home/you/.config/agentqueue/scripts/check-calendar.sh"
    prompt: "Prepare for the upcoming meeting: {{before_output}}"

  # Webhook: triggered by GitHub events
  - name: pr-review
    type: webhook
    source: github
    events:
      - pull_request
    filters:
      - field: action
        in: ["opened", "synchronize"]
    target: "{{repository.name}}"
    prompt: "Review PR #{{pull_request.number}}: {{pull_request.title}}"
```

### 4. Build

```bash
npm install
npm run build
```

### 5. Run as a systemd user service (recommended)

AgentQueue spawns agent CLIs (`af`, `pi`, `claude`, etc.) as child processes. These need to be on PATH. Since systemd user services don't inherit your shell PATH, you must configure it via `environment.d`:

```bash
# ~/.config/environment.d/path.conf
# Set this to your shell's PATH (run `echo $PATH` to get it)
PATH=/home/you/.local/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin
```

Then import it into the running systemd user manager:

```bash
systemctl --user import-environment PATH
```

Create the service unit:

```ini
# ~/.config/systemd/user/agentqueue.service
[Unit]
Description=AgentQueue
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/agentqueue
ExecStart=/absolute/path/to/node dist/src/main.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

**Note:** `ExecStart` requires an absolute path to the `node` binary (systemd requirement). Find it with `which node`. The agent CLIs spawned by the processor are found via PATH.

Enable linger so user services survive logout and start at boot:

```bash
sudo loginctl enable-linger $USER
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now agentqueue
systemctl --user status agentqueue    # verify it's running
journalctl --user -u agentqueue -f   # follow logs
```

### Alternative: run directly

```bash
npm run start:dev    # development (watch mode)
npm run start:prod   # production
```

## Usage

### Submit a job manually

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "target": "my-project",
    "prompt": "Fix the failing tests in src/utils"
  }'
# => {"id":"1"}
```

With optional fields:

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "target": "my-project",
    "prompt": "Refactor the auth module",
    "agent": "claude",
    "priority": 1
  }'
```

### Check job status

```bash
curl http://localhost:3000/jobs/1
```

### Cancel a job

```bash
curl -X DELETE http://localhost:3000/jobs/1
```

### GitHub webhook

Point your GitHub webhook to `https://your-host/webhooks/github` with the same secret as `GITHUB_WEBHOOK_SECRET`. Events matching triggers in `triggers.yaml` will be enqueued automatically.

#### Webhook filters

Webhook triggers support payload-level filtering via the `filters` field. All filters are AND-ed — every filter must pass for the trigger to match. Each filter resolves a dot-path into the webhook payload body and checks a condition:

| Condition | Description |
|---|---|
| `equals` | Exact string match |
| `contains` | Substring match (string fields only) |
| `in` | Value is one of the listed strings |
| `pattern` | Regex match |

Example: trigger only when a specific GitHub user is requested as PR reviewer:

```yaml
- name: ai-agent-review
  type: webhook
  source: github
  events:
    - pull_request
  filters:
    - field: action
      equals: review_requested
    - field: requested_reviewer.login
      equals: my-ai-agent-bot
  target: "{{repository.name}}"
  agent: reviewer
  prompt: |
    Review PR #{{pull_request.number}} in {{repository.full_name}}.
    PR title: {{pull_request.title}}
    Branch: {{pull_request.head.ref}} → {{pull_request.base.ref}}
    URL: {{pull_request.html_url}}
```

Filters use dot-notation to access nested fields (e.g. `requested_reviewer.login`, `pull_request.head.ref`). Triggers without `filters` match all payloads for the configured `events` (backward compatible).

### Before hook

Triggers support an optional `before` field that specifies a script to run before spawning the agent. This enables **gate** and **enrichment** patterns — e.g., "only run meeting prep if there's a meeting in the next 30 minutes."

**Script contract:**

| Exit code | Behavior |
|---|---|
| `0` | Proceed — the agent is spawned. If the script produces stdout, it replaces all `{{before_output}}` placeholders in the prompt. |
| Non-zero | Skip — the job returns `{ success: true, output: 'skipped' }` and the agent is **not** spawned. |
| Timeout | Skip — same as non-zero. Default timeout is 30 seconds (`BEFORE_HOOK_TIMEOUT`). |

The script is executed via `sh -c <before>`, so it can be a path to a script or an inline shell command.

**Example trigger:**

```yaml
- name: meeting-prep
  type: cron
  schedule: "*/30 8-17 * * 1-5"
  target: assistant
  before: "/home/you/scripts/check-calendar.sh"
  prompt: "Prepare for the upcoming meeting: {{before_output}}"
```

If `check-calendar.sh` exits 0 and prints `"Standup at 10:00 — discuss deployment"`, the agent receives the prompt:
```
Prepare for the upcoming meeting: Standup at 10:00 — discuss deployment
```

If the script exits non-zero (no meetings), the job is silently skipped.

### Bull Board dashboard

Open `http://localhost:3000/admin/queues` to monitor queues, view job status, retry failed jobs, etc.

## Live Events

The processor runs agents in JSON mode (`--mode json`) and parses stdout into normalized events, which are written to Redis streams. Events are retained for 24 hours after job completion.

### Event types

| Type | Description |
|---|---|
| `turn_start` | New agent turn began |
| `tool_start` | Tool execution started (includes tool name + args) |
| `tool_end` | Tool execution finished (includes success/error) |
| `text_delta` | Incremental text output from the agent |
| `agent_end` | Agent finished |
| `log` | Raw non-JSON stdout line |
| `error` | Error event |

### REST API

```bash
# Get all events for a job (JSON array)
curl http://localhost:3000/jobs/1/events

# Stream events via SSE
curl http://localhost:3000/jobs/1/events/stream
```

## `aq` CLI

A command-line interface for interacting with AgentQueue. Set `AQ_URL` to point to your server (default: `http://localhost:3000`).

```bash
export AQ_URL=http://localhost:3000
```

### Commands

```bash
# List jobs (default: 20 most recent)
aq jobs
aq jobs --active
aq jobs --failed -n 5

# Check job status
aq status <job-id>

# Watch a job in real time (SSE stream)
aq watch <job-id>

# View logs for a completed job
aq logs <job-id>

# Submit a new job
aq run <target> "<prompt>"
aq run my-project "Fix the tests" --watch          # submit and watch
aq run my-project "Refactor auth" --agent claude    # specify agent
aq run my-project "Urgent fix" --priority 1         # set priority

# Cancel a job
aq kill <job-id>
```

### Installation

After building, link the CLI globally:

```bash
npm run build
npm link    # makes `aq` available globally
```

Or run directly:

```bash
node dist/cli/aq.js <command>
```

## Scripts

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript |
| `npm run start:dev` | Start in watch mode |
| `npm run start:prod` | Start from compiled `dist/` |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run e2e tests (requires Redis) |
| `npm run lint` | Lint and auto-fix |

## License

UNLICENSED
