import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AgentJobData } from './job.interface.js';
import { JobResponseDto } from './dto/job-response.dto.js';

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
    const response = new JobResponseDto();
    response.id = job.id!;
    response.status = state;
    response.target = (job.data as AgentJobData).target;
    response.prompt = (job.data as AgentJobData).prompt;
    response.createdAt = new Date(job.timestamp);
    response.finishedAt = job.finishedOn ? new Date(job.finishedOn) : undefined;
    response.result = job.returnvalue as unknown;
    return response;
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
