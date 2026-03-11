# AGENTS.md — Agent Instructions

This file describes the AgentQueue codebase for AI coding assistants.

## What this is

AgentQueue is a NestJS application that queues and executes AI agent tasks. It receives jobs via REST API, cron schedules, or webhooks, queues them through BullMQ (backed by Redis), and executes them by spawning `agentfiles exec`.

## Module structure

```
src/
├── main.ts                          # Bootstrap, ValidationPipe, port binding
├── app.module.ts                    # Root module (Config, Bull, Triggers, Jobs, Events, BullBoard)
├── config/
│   ├── config.module.ts             # ConfigModule + EngineConfigService provider
│   ├── engine-config.service.ts     # Loads env vars + triggers.yaml
│   └── trigger-config.interface.ts  # TypeScript interfaces for trigger configs
├── redis/
│   └── redis.module.ts              # Global module: provides REDIS_CLIENT (ioredis)
├── events/
│   ├── events.module.ts             # EventsModule: EventStoreService + EventsController
│   ├── events.controller.ts         # GET /jobs/:id/events (JSON + SSE)
│   ├── event-store.service.ts       # Redis streams: append, getAll, stream, expire
│   ├── agent-event.interface.ts     # AgentEvent type (normalized event shape)
│   ├── event-normalizer.ts          # normalizeEvent(): raw JSON → AgentEvent | null
│   ├── event-normalizer.spec.ts     # Unit tests for normalizer
│   ├── event-store.service.spec.ts  # Unit tests for event store (mocked Redis)
│   └── validation.ts               # Event field validation helpers
├── jobs/
│   ├── jobs.module.ts               # BullMQ queue registration + processor
│   ├── jobs.service.ts              # Enqueue, status, cancel, list operations
│   ├── jobs.processor.ts            # Worker: Redis lock → spawn agentfiles (JSON mode) → parse events → release
│   ├── job.interface.ts             # AgentJobData interface
│   └── dto/
│       ├── enqueue-job.dto.ts       # Validation DTO for POST /jobs
│       └── job-response.dto.ts      # Response DTO for GET /jobs/:id
├── triggers/
│   ├── triggers.module.ts           # Aggregates Manual, Cron, Webhook modules
│   ├── manual/
│   │   ├── manual.module.ts
│   │   └── manual.controller.ts     # POST/GET/DELETE/LIST /jobs
│   ├── cron/
│   │   ├── cron.module.ts
│   │   └── cron.service.ts          # Registers BullMQ repeatables from triggers.yaml
│   └── webhook/
│       ├── webhook.module.ts
│       └── webhook.controller.ts    # POST /webhooks/:source, HMAC verify, Handlebars
cli/
├── aq.ts                            # Entry point (Commander), reads AQ_URL env var
├── commands/
│   ├── status.ts                    # aq status <job-id>
│   ├── kill.ts                      # aq kill <job-id>
│   ├── jobs.ts                      # aq jobs [--active|--failed|--completed] [-n N]
│   ├── watch.ts                     # aq watch <job-id> (SSE live view)
│   ├── logs.ts                      # aq logs <job-id> (static event dump)
│   └── run.ts                       # aq run <target> "<prompt>" [--watch] [--agent] [--priority]
└── lib/
    ├── api.ts                       # HTTP client (fetch wrapper, base URL from AQ_URL)
    └── format.ts                    # relativeTime, truncate, toolIcon helpers
```

## Key patterns

### BullMQ processor (`jobs.processor.ts`)

The processor follows this flow:
1. Acquire a Redis lock for the target (`agent-lock:<target>`) using `SET NX EX`
2. If lock fails, throw `DelayedError` — BullMQ retries with exponential backoff (10 attempts)
3. Spawn `agentfiles exec <target> [--agent <agent>] --mode json -- -p <prompt>`
4. Parse stdout line by line: JSON lines → `normalizeEvent()` → `EventStoreService.append()`, non-JSON lines → `{ type: 'log' }` events
5. Release the lock atomically via Lua script (only if we still own it)
6. Set 24-hour TTL on the event stream via `EventStoreService.expire()`

The Lua script for lock release:
```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
```

### Configuration

- Environment variables via `@nestjs/config` (ConfigModule)
- Trigger definitions via `config/triggers.yaml`, loaded by `EngineConfigService`
- All config is validated at startup

### Webhook handling

- HMAC signature verification for GitHub (`x-hub-signature-256`)
- Event matching against trigger definitions
- Handlebars template rendering for `target` and `prompt` fields
- Target sanitization via regex pattern

## Running tests

```bash
# Unit tests (no Redis required)
npm test

# E2e tests (requires Redis on localhost:6379)
npm run test:e2e

# Start dev Redis
docker compose -f docker-compose.dev.yml up -d
```

## Build

```bash
npm run build     # TypeScript → dist/
npm run lint      # ESLint with auto-fix
```

TypeScript is configured with `strict: true`, `nodenext` module resolution.

### Live events (`src/events/`)

- **Event normalizer** — Pure function that maps pi's JSON event types (`tool_execution_start`, `tool_execution_end`, `turn_start`, `message_update`, `agent_end`) to a normalized `AgentEvent` shape. Returns `null` for irrelevant events.
- **Event store** — Uses Redis streams (`XADD`/`XRANGE`/`XREAD BLOCK`) keyed as `aq:events:<jobId>` with `MAXLEN ~ 500`. Provides `append`, `getAll`, `stream` (async generator), and `expire`.
- **Events controller** — `GET /jobs/:id/events` returns JSON array. With `Accept: text/event-stream` or `?stream=true`, returns SSE stream that closes on `agent_end` or client disconnect.

### CLI (`cli/`)

- Entry point: `cli/aq.ts` (Commander-based, reads `AQ_URL` env var)
- Commands: `status`, `kill`, `jobs`, `watch`, `logs`, `run`
- `cli/lib/api.ts` — Shared HTTP client wrapping `fetch`
- `cli/lib/format.ts` — Terminal formatting (relative time, truncation, tool icons)
- Built to `dist/cli/`, registered as `bin.aq` in `package.json`

## Important conventions

- All imports use `.js` extensions (required by `nodenext` module resolution)
- Tests are colocated: `*.spec.ts` next to the source file (unit), `test/` dir (e2e)
- DTOs use `class-validator` decorators with `!` assertion (strict mode)
- The processor captures stdout+stderr from spawned processes, capped at 100KB
- Event streams are capped at 500 entries per job and expire after 24 hours
