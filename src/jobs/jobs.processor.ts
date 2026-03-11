import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue, DelayedError } from 'bullmq';
import { spawn } from 'child_process';
import type Redis from 'ioredis';
import { EngineConfigService } from '../config/engine-config.service.js';
import { AgentJobData } from './job.interface.js';

const MAX_OUTPUT_SIZE = 100 * 1024; // 100KB

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

    try {
      const args = ['exec', target];
      if (agent) {
        args.push('--agent', agent);
      }
      args.push('--', '-p', prompt);

      this.logger.log(`Spawning: agentfiles ${args.join(' ')}`);

      const timeout = this.configService.jobTimeout;
      const output = await this.spawnProcess('agentfiles', args, timeout);
      return { success: true, output };
    } finally {
      // Atomically release lock only if we still own it
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, job.id!);
    }
  }

  private spawnProcess(
    command: string,
    args: string[],
    timeout?: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      let output = '';
      let killed = false;

      const appendOutput = (chunk: Buffer): void => {
        output += chunk.toString();
        if (output.length > MAX_OUTPUT_SIZE) {
          output = output.slice(-MAX_OUTPUT_SIZE);
        }
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeout && timeout > 0) {
        timer = setTimeout(() => {
          killed = true;
          child.kill('SIGTERM');
        }, timeout);
      }

      child.stdout.on('data', appendOutput);
      child.stderr.on('data', appendOutput);

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(new Error(`Failed to spawn process: ${err.message}`));
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
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
