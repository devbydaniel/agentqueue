import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { AgentEvent } from './agent-event.interface.js';

const STREAM_KEY_PREFIX = 'aq:events:';
const MAX_STREAM_LENGTH = 500;
const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

@Injectable()
export class EventStoreService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  private validateJobId(jobId: string): void {
    if (!JOB_ID_PATTERN.test(jobId)) {
      throw new Error(`Invalid jobId: ${jobId}`);
    }
  }

  private parseEntry(fields: string[]): AgentEvent | null {
    const dataIndex = fields.indexOf('data');
    if (dataIndex === -1 || dataIndex + 1 >= fields.length) return null;
    try {
      return JSON.parse(fields[dataIndex + 1]) as AgentEvent;
    } catch {
      return null;
    }
  }

  async append(jobId: string, event: AgentEvent): Promise<void> {
    this.validateJobId(jobId);
    const key = `${STREAM_KEY_PREFIX}${jobId}`;
    await this.redis.xadd(
      key,
      'MAXLEN',
      '~',
      String(MAX_STREAM_LENGTH),
      '*',
      'data',
      JSON.stringify(event),
    );
  }

  async getAll(jobId: string): Promise<AgentEvent[]> {
    this.validateJobId(jobId);
    const key = `${STREAM_KEY_PREFIX}${jobId}`;
    const entries = await this.redis.xrange(key, '-', '+');
    const events: AgentEvent[] = [];
    for (const [, fields] of entries) {
      const event = this.parseEntry(fields);
      if (event) events.push(event);
    }
    return events;
  }

  async *stream(
    jobId: string,
    lastId = '$',
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    this.validateJobId(jobId);
    const key = `${STREAM_KEY_PREFIX}${jobId}`;
    let currentId = lastId;
    const blockingClient = this.redis.duplicate();

    try {
      while (!signal?.aborted) {
        const results = await blockingClient.xread(
          'BLOCK',
          1000,
          'STREAMS',
          key,
          currentId,
        );

        if (!results) continue;

        for (const [, entries] of results) {
          for (const [id, fields] of entries) {
            currentId = id;
            const event = this.parseEntry(fields);
            if (event) yield event;
          }
        }
      }
    } finally {
      await blockingClient.quit();
    }
  }

  async expire(jobId: string, ttlSeconds: number): Promise<void> {
    this.validateJobId(jobId);
    const key = `${STREAM_KEY_PREFIX}${jobId}`;
    await this.redis.expire(key, ttlSeconds);
  }
}
