import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { CronService } from './cron.service.js';
import { EngineConfigService } from '../../config/engine-config.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { CronTrigger } from '../../config/trigger-config.interface.js';

describe('CronService', () => {
  let service: CronService;
  let mockQueue: Record<string, jest.Mock>;
  let mockEngineConfig: Record<string, jest.Mock>;
  let mockJobsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockQueue = {
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
      getJobSchedulers: jest.fn().mockResolvedValue([]),
      removeJobScheduler: jest.fn().mockResolvedValue(undefined),
    };

    mockEngineConfig = {
      getCronTriggers: jest.fn().mockReturnValue([]),
    };

    mockJobsService = {
      enqueue: jest.fn().mockResolvedValue('job-001'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronService,
        {
          provide: getQueueToken('agent-jobs'),
          useValue: mockQueue,
        },
        {
          provide: EngineConfigService,
          useValue: mockEngineConfig,
        },
        {
          provide: JobsService,
          useValue: mockJobsService,
        },
      ],
    }).compile();

    service = module.get<CronService>(CronService);
  });

  describe('onModuleInit', () => {
    it('should clean up stale schedulers before registering', async () => {
      const triggers: CronTrigger[] = [
        {
          name: 'daily-review',
          type: 'cron',
          target: 'myrepo',
          prompt: 'Review open PRs',
          schedule: '0 9 * * *',
        },
      ];
      mockEngineConfig.getCronTriggers.mockReturnValue(triggers);
      mockQueue.getJobSchedulers.mockResolvedValue([
        { id: 'cron-daily-review' },
        { id: 'cron-old-stale-trigger' },
      ]);

      await service.onModuleInit();

      // Should remove the stale scheduler
      expect(mockQueue.removeJobScheduler).toHaveBeenCalledWith(
        'cron-old-stale-trigger',
      );
      expect(mockQueue.removeJobScheduler).toHaveBeenCalledTimes(1);
      // Should still register the configured trigger
      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    });

    it('should register cron triggers as BullMQ job schedulers', async () => {
      const triggers: CronTrigger[] = [
        {
          name: 'daily-review',
          type: 'cron',
          target: 'myrepo',
          prompt: 'Review open PRs',
          schedule: '0 9 * * *',
        },
        {
          name: 'weekly-cleanup',
          type: 'cron',
          target: 'infra',
          prompt: 'Clean up stale branches',
          schedule: '0 0 * * 0',
        },
      ];
      mockEngineConfig.getCronTriggers.mockReturnValue(triggers);

      await service.onModuleInit();

      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledTimes(2);
      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'cron-daily-review',
        { pattern: '0 9 * * *' },
        {
          name: 'agent-job',
          data: {
            target: 'myrepo',
            prompt: 'Review open PRs',
            trigger: { type: 'cron', source: 'daily-review' },
          },
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 },
          },
        },
      );
      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'cron-weekly-cleanup',
        { pattern: '0 0 * * 0' },
        {
          name: 'agent-job',
          data: {
            target: 'infra',
            prompt: 'Clean up stale branches',
            trigger: { type: 'cron', source: 'weekly-cleanup' },
          },
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 },
          },
        },
      );
    });

    it('should include before in job data when trigger has before', async () => {
      const triggers: CronTrigger[] = [
        {
          name: 'meeting-prep',
          type: 'cron',
          target: 'assistant',
          prompt: 'Prepare for meeting: {{before_output}}',
          schedule: '0 8 * * *',
          before: '/scripts/check-calendar.sh',
        },
      ];
      mockEngineConfig.getCronTriggers.mockReturnValue(triggers);

      await service.onModuleInit();

      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'cron-meeting-prep',
        { pattern: '0 8 * * *' },
        {
          name: 'agent-job',
          data: {
            target: 'assistant',
            prompt: 'Prepare for meeting: {{before_output}}',
            trigger: { type: 'cron', source: 'meeting-prep' },
            before: '/scripts/check-calendar.sh',
          },
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 },
          },
        },
      );
    });

    it('should handle empty trigger list gracefully', async () => {
      mockEngineConfig.getCronTriggers.mockReturnValue([]);

      await service.onModuleInit();

      expect(mockQueue.upsertJobScheduler).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should remove stale schedulers not in config', async () => {
      mockEngineConfig.getCronTriggers.mockReturnValue([
        {
          name: 'daily-review',
          type: 'cron' as const,
          target: 'myrepo',
          prompt: 'Review',
          schedule: '0 9 * * *',
        },
      ]);
      mockQueue.getJobSchedulers.mockResolvedValue([
        { id: 'cron-daily-review' },
        { id: 'cron-old-trigger' },
      ]);

      await service.onModuleDestroy();

      expect(mockQueue.removeJobScheduler).toHaveBeenCalledTimes(1);
      expect(mockQueue.removeJobScheduler).toHaveBeenCalledWith(
        'cron-old-trigger',
      );
    });

    it('should not remove non-cron schedulers', async () => {
      mockEngineConfig.getCronTriggers.mockReturnValue([]);
      mockQueue.getJobSchedulers.mockResolvedValue([{ id: 'other-scheduler' }]);

      await service.onModuleDestroy();

      expect(mockQueue.removeJobScheduler).not.toHaveBeenCalled();
    });

    it('should handle errors during cleanup gracefully', async () => {
      mockEngineConfig.getCronTriggers.mockReturnValue([]);
      mockQueue.getJobSchedulers.mockRejectedValue(
        new Error('Connection lost'),
      );

      // Should not throw
      await service.onModuleDestroy();
    });
  });
});
