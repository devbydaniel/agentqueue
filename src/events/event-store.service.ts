import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { AgentEvent } from './agent-event.interface.js';

const STREAM_KEY_PREFIX = 'aq:events:';
const MAX_STREAM_LENGTH = 500;

@Injectable()
export class EventStoreService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async append(jobId: string, event: AgentEvent): Promise<void> {
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
    const key = `${STREAM_KEY_PREFIX}${jobId}`;
    const entries = await this.redis.xrange(key, '-', '+');
    return entries.map(([, fields]) => {
      const dataIndex = fields.indexOf('data');
      return JSON.parse(fields[dataIndex + 1]) as AgentEvent;
    });
  }

  async *stream(
    jobId: string,
    lastId = '$',
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const key = `${STREAM_KEY_PREFIX}${jobId}`;
    let currentId = lastId;

    while (!signal?.aborted) {
      const results = await this.redis.xread(
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
          const dataIndex = fields.indexOf('data');
          yield JSON.parse(fields[dataIndex + 1]) as AgentEvent;
        }
      }
    }
  }

  async expire(jobId: string, ttlSeconds: number): Promise<void> {
    const key = `${STREAM_KEY_PREFIX}${jobId}`;
    await this.redis.expire(key, ttlSeconds);
  }
}
