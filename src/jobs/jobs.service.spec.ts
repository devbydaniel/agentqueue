import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { AgentJobData } from './job.interface.js';

describe('JobsService', () => {
  let service: JobsService;
  let mockQueue: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn(),
      getJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: getQueueToken('agent-jobs'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<JobsService>(JobsService);
  });

  describe('enqueue', () => {
    it('should add a job to the queue and return the job ID', async () => {
      mockQueue.add.mockResolvedValue({ id: 'job-123' });

      const data: AgentJobData = {
        target: 'myrepo',
        prompt: 'Fix the bug',
        trigger: { type: 'api' },
      };

      const id = await service.enqueue(data);

      expect(id).toBe('job-123');
      expect(mockQueue.add).toHaveBeenCalledWith('agent-job', data, {
        priority: undefined,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      });
    });

    it('should pass priority when provided', async () => {
      mockQueue.add.mockResolvedValue({ id: 'job-456' });

      const data: AgentJobData = {
        target: 'myrepo',
        prompt: 'Fix the bug',
        trigger: { type: 'api' },
        priority: 1,
      };

      await service.enqueue(data);

      expect(mockQueue.add).toHaveBeenCalledWith('agent-job', data, {
        priority: 1,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      });
    });
  });

  describe('getStatus', () => {
    it('should return a mapped JobResponseDto', async () => {
      const now = Date.now();
      mockQueue.getJob.mockResolvedValue({
        id: 'job-123',
        data: { target: 'myrepo', prompt: 'Fix the bug' },
        timestamp: now,
        finishedOn: now + 10000,
        returnvalue: { success: true, output: 'done' },
        getState: jest.fn().mockResolvedValue('completed'),
      });

      const result = await service.getStatus('job-123');

      expect(result.id).toBe('job-123');
      expect(result.status).toBe('completed');
      expect(result.target).toBe('myrepo');
      expect(result.prompt).toBe('Fix the bug');
      expect(result.createdAt).toEqual(new Date(now));
      expect(result.finishedAt).toEqual(new Date(now + 10000));
      expect(result.result).toEqual({ success: true, output: 'done' });
    });

    it('should throw NotFoundException when job does not exist', async () => {
      mockQueue.getJob.mockResolvedValue(null);

      await expect(service.getStatus('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle job without finishedOn', async () => {
      mockQueue.getJob.mockResolvedValue({
        id: 'job-123',
        data: { target: 'myrepo', prompt: 'test' },
        timestamp: Date.now(),
        finishedOn: undefined,
        returnvalue: undefined,
        getState: jest.fn().mockResolvedValue('active'),
      });

      const result = await service.getStatus('job-123');
      expect(result.finishedAt).toBeUndefined();
      expect(result.result).toBeUndefined();
    });
  });

  describe('cancel', () => {
    it('should remove the job when it is not active', async () => {
      const removeMock = jest.fn().mockResolvedValue(undefined);
      mockQueue.getJob.mockResolvedValue({
        remove: removeMock,
        getState: jest.fn().mockResolvedValue('waiting'),
      });

      await service.cancel('job-123');

      expect(mockQueue.getJob).toHaveBeenCalledWith('job-123');
      expect(removeMock).toHaveBeenCalled();
    });

    it('should moveToFailed when job is active', async () => {
      const moveToFailedMock = jest.fn().mockResolvedValue(undefined);
      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        moveToFailed: moveToFailedMock,
      });

      await service.cancel('job-123');

      expect(moveToFailedMock).toHaveBeenCalledWith(
        expect.any(Error),
        'cancel',
        true,
      );
    });

    it('should fallback to moveToFailed when remove fails', async () => {
      const moveToFailedMock = jest.fn().mockResolvedValue(undefined);
      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('waiting'),
        remove: jest.fn().mockRejectedValue(new Error('Job is active')),
        moveToFailed: moveToFailedMock,
      });

      await service.cancel('job-123');

      expect(moveToFailedMock).toHaveBeenCalledWith(
        expect.any(Error),
        'cancel',
        true,
      );
    });

    it('should throw NotFoundException when job does not exist', async () => {
      mockQueue.getJob.mockResolvedValue(null);

      await expect(service.cancel('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
