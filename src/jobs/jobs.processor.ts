import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue, DelayedError } from 'bullmq';
import { spawn } from 'child_process';
import type Redis from 'ioredis';
import { EngineConfigService } from '../config/engine-config.service.js';
import { EventStoreService } from '../events/event-store.service.js';
import { normalizeEvent } from '../events/event-normalizer.js';
import { AgentJobData } from './job.interface.js';

const MAX_OUTPUT_SIZE = 100 * 1024; // 100KB
const EVENT_TTL_SECONDS = 86400; // 24 hours

const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

@Processor('agent-jobs')
export class JobsProcessor extends WorkerHost {
  private readonly logger = new Logger(JobsProcessor.name);

  constructor(
    @InjectQueue('agent-jobs') private readonly queue: Queue,
    private readonly configService: EngineConfigService,
    private readonly eventStore: EventStoreService,
  ) {
    super();
  }

  private async getRedisClient(): Promise<Redis> {
    return (await this.queue.client) as unknown as Redis;
  }

  async process(
    job: Job<AgentJobData>,
  ): Promise<{ success: boolean; output: string }> {
    const { target, prompt, agent } = job.data;
    const lockKey = `agent-lock:${target}`;
    const lockTtl = this.configService.lockTtl;

    const redis = await this.getRedisClient();

    // Acquire lock
    const lockResult = await redis.set(lockKey, job.id!, 'EX', lockTtl, 'NX');
    if (!lockResult) {
      this.logger.warn(
        `Lock contention for target "${target}", job ${job.id} will retry`,
      );
      throw new DelayedError('Target is locked by another job');
    }

    const pendingAppends: Promise<void>[] = [];
    try {
      const args = ['exec', target];
      if (agent) {
        args.push('--agent', agent);
      }
      args.push('--', '--mode', 'json', '-p', prompt);

      this.logger.log(`Spawning: af ${args.join(' ')}`);

      const timeout = this.configService.jobTimeout;
      const output = await this.spawnProcess(
        'af',
        args,
        job.id!,
        timeout,
        pendingAppends,
      );
      return { success: true, output };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const MAX_ERROR_TEXT = 500;
      const truncatedMessage =
        message.length > MAX_ERROR_TEXT
          ? message.slice(0, MAX_ERROR_TEXT) + '…'
          : message;
      const errorEvent = {
        type: 'error' as const,
        timestamp: Date.now(),
        text: truncatedMessage,
      };
      pendingAppends.push(
        this.eventStore.append(job.id!, errorEvent).catch((e: unknown) => {
          this.logger.warn(`Failed to append error event: ${String(e)}`);
        }),
      );
      throw err;
    } finally {
      // Atomically release lock only if we still own it
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, job.id!);
      // Wait for all in-flight appends before setting TTL
      await Promise.allSettled(pendingAppends);
      // Set TTL on the event stream
      await this.eventStore.expire(job.id!, EVENT_TTL_SECONDS);
    }
  }

  private spawnProcess(
    command: string,
    args: string[],
    jobId: string,
    timeout: number | undefined,
    pendingAppends: Promise<void>[],
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.end();
      let output = '';
      let killed = false;
      let stdoutBuffer = '';

      const appendOutput = (text: string): void => {
        output += text;
        if (output.length > MAX_OUTPUT_SIZE) {
          output = output.slice(-MAX_OUTPUT_SIZE);
        }
      };

      const trackAppend = (promise: Promise<void>): void => {
        pendingAppends.push(
          promise.catch((err: unknown) => {
            this.logger.warn(`Failed to append event: ${String(err)}`);
          }),
        );
      };

      const processLine = (line: string): void => {
        if (!line.trim()) return;

        let parsed: Record<string, unknown> | undefined;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Not JSON — emit as log event
          const logEvent = {
            type: 'log' as const,
            timestamp: Date.now(),
            text: line.length > 500 ? line.slice(0, 500) : line,
          };
          trackAppend(this.eventStore.append(jobId, logEvent));
          return;
        }

        const event = normalizeEvent(parsed);
        if (event) {
          trackAppend(this.eventStore.append(jobId, event));
        }
      };

      const handleStdoutChunk = (chunk: Buffer): void => {
        const text = chunk.toString();
        appendOutput(text);

        stdoutBuffer += text;
        const lines = stdoutBuffer.split('\n');
        // Keep the last element (may be incomplete)
        stdoutBuffer = lines.pop()!;
        for (const line of lines) {
          processLine(line);
        }
      };

      const handleStderrChunk = (chunk: Buffer): void => {
        const text = chunk.toString();
        appendOutput(text);
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeout && timeout > 0) {
        timer = setTimeout(() => {
          killed = true;
          child.kill('SIGTERM');
        }, timeout);
      }

      child.stdout.on('data', handleStdoutChunk);
      child.stderr.on('data', handleStderrChunk);

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(new Error(`Failed to spawn process: ${err.message}`));
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        // Process any remaining buffered stdout
        if (stdoutBuffer.trim()) {
          processLine(stdoutBuffer);
        }
        if (killed) {
          reject(new Error(`Process timed out after ${timeout}ms: ${output}`));
        } else if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Process exited with code ${code}: ${output}`));
        }
      });
    });
  }
}
