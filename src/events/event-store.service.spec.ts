import { EventStoreService } from './event-store.service.js';
import type Redis from 'ioredis';
import type { AgentEvent } from './agent-event.interface.js';

describe('EventStoreService', () => {
  let service: EventStoreService;
  let mockRedis: Partial<Redis>;

  const sampleEvent: AgentEvent = {
    type: 'tool_start',
    timestamp: 1000,
    tool: 'bash',
    toolArgs: { command: 'ls' },
  };

  beforeEach(() => {
    mockRedis = {
      xadd: jest.fn().mockResolvedValue('1-0'),
      xrange: jest.fn().mockResolvedValue([]),
      xread: jest.fn().mockResolvedValue(null),
      expire: jest.fn().mockResolvedValue(1),
    };

    service = new EventStoreService(mockRedis as Redis);
  });

  describe('append', () => {
    it('should call XADD with correct key and MAXLEN', async () => {
      await service.append('job-123', sampleEvent);

      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'aq:events:job-123',
        'MAXLEN',
        '~',
        '500',
        '*',
        'data',
        JSON.stringify(sampleEvent),
      );
    });
  });

  describe('getAll', () => {
    it('should call XRANGE and parse results', async () => {
      const serialized = JSON.stringify(sampleEvent);
      (mockRedis.xrange as jest.Mock).mockResolvedValue([
        ['1-0', ['data', serialized]],
        ['2-0', ['data', serialized]],
      ]);

      const events = await service.getAll('job-123');

      expect(mockRedis.xrange).toHaveBeenCalledWith(
        'aq:events:job-123',
        '-',
        '+',
      );
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(sampleEvent);
    });

    it('should return empty array when no events', async () => {
      (mockRedis.xrange as jest.Mock).mockResolvedValue([]);

      const events = await service.getAll('job-123');
      expect(events).toEqual([]);
    });
  });

  describe('expire', () => {
    it('should call EXPIRE with correct TTL', async () => {
      await service.expire('job-123', 86400);

      expect(mockRedis.expire).toHaveBeenCalledWith('aq:events:job-123', 86400);
    });
  });
});
