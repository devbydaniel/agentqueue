# AGENTS.md — Agent Instructions

This file describes the AgentQueue codebase for AI coding assistants.

## What this is

AgentQueue is a NestJS application that queues and executes AI agent tasks. It receives jobs via REST API, cron schedules, or webhooks, queues them through BullMQ (backed by Redis), and executes them by spawning `agentfiles exec`.

## Module structure

```
src/
├── main.ts                          # Bootstrap, ValidationPipe, port binding
├── app.module.ts                    # Root module (Config, Bull, Triggers, Jobs, BullBoard)
├── config/
│   ├── config.module.ts             # ConfigModule + EngineConfigService provider
│   ├── engine-config.service.ts     # Loads env vars + triggers.yaml
│   └── trigger-config.interface.ts  # TypeScript interfaces for trigger configs
├── jobs/
│   ├── jobs.module.ts               # BullMQ queue registration + processor
│   ├── jobs.service.ts              # Enqueue, status, cancel operations
│   ├── jobs.processor.ts            # Worker: Redis lock → spawn agentfiles → release
│   ├── job.interface.ts             # AgentJobData interface
│   └── dto/
│       ├── enqueue-job.dto.ts       # Validation DTO for POST /jobs
│       └── job-response.dto.ts      # Response DTO for GET /jobs/:id
├── triggers/
│   ├── triggers.module.ts           # Aggregates Manual, Cron, Webhook modules
│   ├── manual/
│   │   ├── manual.module.ts
│   │   └── manual.controller.ts     # POST/GET/DELETE /jobs
│   ├── cron/
│   │   ├── cron.module.ts
│   │   └── cron.service.ts          # Registers BullMQ repeatables from triggers.yaml
│   └── webhook/
│       ├── webhook.module.ts
│       └── webhook.controller.ts    # POST /webhooks/:source, HMAC verify, Handlebars
```

## Key patterns

### BullMQ processor (`jobs.processor.ts`)

The processor follows this flow:
1. Acquire a Redis lock for the target (`agent-lock:<target>`) using `SET NX EX`
2. If lock fails, throw `DelayedError` — BullMQ retries with exponential backoff (10 attempts)
3. Spawn `agentfiles exec <target> [--agent <agent>] -- -p <prompt>`
4. Release the lock atomically via Lua script (only if we still own it)

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

## Important conventions

- All imports use `.js` extensions (required by `nodenext` module resolution)
- Tests are colocated: `*.spec.ts` next to the source file (unit), `test/` dir (e2e)
- DTOs use `class-validator` decorators with `!` assertion (strict mode)
- The processor captures stdout+stderr from spawned processes, capped at 100KB
