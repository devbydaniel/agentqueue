import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import type { JobType } from 'bullmq';
import { AgentJobData } from './job.interface.js';
import { JobResponseDto } from './dto/job-response.dto.js';

function toDto(
  job: Job,
  state: string,
  opts?: { includeResult?: boolean },
): JobResponseDto {
  const data = job.data as AgentJobData;
  const response = new JobResponseDto();
  response.id = job.id!;
  response.status = state;
  response.target = data.target;
  response.prompt = data.prompt;
  response.createdAt = new Date(job.timestamp);
  response.finishedAt = job.finishedOn ? new Date(job.finishedOn) : undefined;
  if (opts?.includeResult) {
    response.result = job.returnvalue as unknown;
  }
  return response;
}

@Injectable()
export class JobsService {
  constructor(@InjectQueue('agent-jobs') private readonly queue: Queue) {}

  async enqueue(data: AgentJobData): Promise<string> {
    const job = await this.queue.add('agent-job', data, {
      priority: data.priority,
      attempts: 10,
      backoff: { type: 'exponential', delay: 5000 },
    });
    return job.id!;
  }

  async getStatus(id: string): Promise<JobResponseDto> {
    const job = await this.queue.getJob(id);
    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }

    const state = await job.getState();
    return toDto(job, state, { includeResult: true });
  }

  async list(
    options: {
      status?: string;
      limit?: number;
    } = {},
  ): Promise<JobResponseDto[]> {
    const limit = Math.min(options.limit ?? 20, 100);
    const stateMap: Record<string, JobType[]> = {
      all: ['active', 'completed', 'failed', 'waiting', 'delayed'],
      active: ['active'],
      completed: ['completed'],
      failed: ['failed'],
      waiting: ['waiting'],
      delayed: ['delayed'],
    };
    const states = stateMap[options.status ?? 'all'] ?? stateMap['all'];

    const jobs = await this.queue.getJobs(states, 0, limit - 1);

    // Sort by creation time descending
    jobs.sort((a, b) => b.timestamp - a.timestamp);

    const limited = jobs.slice(0, limit);

    return Promise.all(
      limited.map(async (job) => toDto(job, await job.getState())),
    );
  }

  async cancel(id: string): Promise<void> {
    const job = await this.queue.getJob(id);
    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }

    const state = await job.getState();
    if (state === 'active') {
      await job.moveToFailed(
        new Error('Job cancelled by user'),
        'cancel',
        true,
      );
    } else {
      try {
        await job.remove();
      } catch {
        // Job may have transitioned to active between getState and remove
        await job.moveToFailed(
          new Error('Job cancelled by user'),
          'cancel',
          true,
        );
      }
    }
  }
}
