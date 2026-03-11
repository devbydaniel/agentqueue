import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { AgentEvent } from './agent-event.interface.js';
import { validateJobId } from './validation.js';

export interface GetAllResult {
  events: AgentEvent[];
  lastId: string | null;
}

const STREAM_KEY_PREFIX = 'aq:events:';
const MAX_STREAM_LENGTH = 500;

@Injectable()
export class EventStoreService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(jobId: string): string {
    validateJobId(jobId);
    return `${STREAM_KEY_PREFIX}${jobId}`;
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
    const k = this.key(jobId);
    await this.redis.xadd(
      k,
      'MAXLEN',
      '~',
      String(MAX_STREAM_LENGTH),
      '*',
      'data',
      JSON.stringify(event),
    );
  }

  async getAll(jobId: string): Promise<GetAllResult> {
    const k = this.key(jobId);
    const entries = await this.redis.xrange(k, '-', '+');
    const events: AgentEvent[] = [];
    let lastId: string | null = null;
    for (const [id, fields] of entries) {
      lastId = id;
      const event = this.parseEntry(fields);
      if (event) events.push(event);
    }
    return { events, lastId };
  }

  async *stream(
    jobId: string,
    lastId = '$',
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const k = this.key(jobId);
    let currentId = lastId;
    const blockingClient = this.redis.duplicate();

    try {
      while (!signal?.aborted) {
        const results = await blockingClient.xread(
          'BLOCK',
          1000,
          'STREAMS',
          k,
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
    const k = this.key(jobId);
    await this.redis.expire(k, ttlSeconds);
  }
}
