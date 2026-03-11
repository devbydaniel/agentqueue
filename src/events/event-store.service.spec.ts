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
      duplicate: jest.fn().mockReturnValue({
        xread: jest.fn().mockResolvedValue(null),
        quit: jest.fn().mockResolvedValue('OK'),
      }),
    };

    service = new EventStoreService(mockRedis as Redis);
  });

  describe('jobId validation', () => {
    it('should reject jobIds with special characters', async () => {
      await expect(service.append('../etc', sampleEvent)).rejects.toThrow(
        'Invalid jobId',
      );
      await expect(service.getAll('foo bar')).rejects.toThrow('Invalid jobId');
      await expect(service.expire('a/b', 100)).rejects.toThrow('Invalid jobId');
    });

    it('should accept valid jobIds', async () => {
      await service.append('job-123', sampleEvent);
      expect(mockRedis.xadd).toHaveBeenCalled();

      await service.getAll('job_456');
      expect(mockRedis.xrange).toHaveBeenCalled();
    });
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

    it('should skip entries with missing data field', async () => {
      const serialized = JSON.stringify(sampleEvent);
      (mockRedis.xrange as jest.Mock).mockResolvedValue([
        ['1-0', ['other', 'value']],
        ['2-0', ['data', serialized]],
      ]);

      const events = await service.getAll('job-123');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(sampleEvent);
    });

    it('should skip entries with malformed JSON', async () => {
      (mockRedis.xrange as jest.Mock).mockResolvedValue([
        ['1-0', ['data', '{not-json']],
        ['2-0', ['data', JSON.stringify(sampleEvent)]],
      ]);

      const events = await service.getAll('job-123');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(sampleEvent);
    });

    it('should skip entries where data is the last field (no value)', async () => {
      (mockRedis.xrange as jest.Mock).mockResolvedValue([['1-0', ['data']]]);

      const events = await service.getAll('job-123');
      expect(events).toHaveLength(0);
    });
  });

  describe('expire', () => {
    it('should call EXPIRE with correct TTL', async () => {
      await service.expire('job-123', 86400);

      expect(mockRedis.expire).toHaveBeenCalledWith('aq:events:job-123', 86400);
    });
  });

  describe('stream', () => {
    it('should use a duplicated client for blocking reads', async () => {
      const controller = new AbortController();
      controller.abort();

      const gen = service.stream('job-123', '$', controller.signal);
      await gen.next();

      expect(mockRedis.duplicate).toHaveBeenCalled();
    });

    it('should quit the duplicated client on cleanup', async () => {
      const mockBlockingClient = {
        xread: jest.fn().mockResolvedValue(null),
        quit: jest.fn().mockResolvedValue('OK'),
      };
      (mockRedis.duplicate as jest.Mock).mockReturnValue(mockBlockingClient);

      const controller = new AbortController();
      controller.abort();

      const gen = service.stream('job-123', '$', controller.signal);
      await gen.next();

      expect(mockBlockingClient.quit).toHaveBeenCalled();
    });
  });
});
