import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ManualController } from './manual.controller.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { EnqueueJobDto } from '../../jobs/dto/enqueue-job.dto.js';
import { JobResponseDto } from '../../jobs/dto/job-response.dto.js';

describe('ManualController', () => {
  let controller: ManualController;
  let jobsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    jobsService = {
      enqueue: jest.fn(),
      getStatus: jest.fn(),
      cancel: jest.fn(),
      list: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ManualController],
      providers: [
        {
          provide: JobsService,
          useValue: jobsService,
        },
      ],
    }).compile();

    controller = module.get<ManualController>(ManualController);
  });

  describe('POST /jobs', () => {
    it('should enqueue a job and return the ID', async () => {
      jobsService.enqueue.mockResolvedValue('job-123');

      const dto: EnqueueJobDto = {
        target: 'myrepo',
        prompt: 'Fix the bug',
      };

      const result = await controller.enqueue(dto);

      expect(result).toEqual({ id: 'job-123' });
      expect(jobsService.enqueue).toHaveBeenCalledWith({
        target: 'myrepo',
        prompt: 'Fix the bug',
        trigger: { type: 'manual' },
        agent: undefined,
        priority: undefined,
      });
    });

    it('should use provided trigger if present', async () => {
      jobsService.enqueue.mockResolvedValue('job-456');

      const dto: EnqueueJobDto = {
        target: 'myrepo',
        prompt: 'Fix the bug',
        trigger: { type: 'api', source: 'ci' },
      };

      const result = await controller.enqueue(dto);

      expect(result).toEqual({ id: 'job-456' });
      expect(jobsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: { type: 'api', source: 'ci' },
        }),
      );
    });

    it('should pass agent and priority when provided', async () => {
      jobsService.enqueue.mockResolvedValue('job-789');

      const dto: EnqueueJobDto = {
        target: 'myrepo',
        prompt: 'Deploy',
        agent: 'claude',
        priority: 1,
      };

      const result = await controller.enqueue(dto);

      expect(result).toEqual({ id: 'job-789' });
      expect(jobsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'claude',
          priority: 1,
        }),
      );
    });
  });

  describe('GET /jobs', () => {
    it('should return jobs with default options', async () => {
      const jobs = [
        Object.assign(new JobResponseDto(), {
          id: 'job-1',
          status: 'active',
          target: 'repo1',
          prompt: 'Do stuff',
          createdAt: new Date(),
        }),
      ];
      jobsService.list.mockResolvedValue(jobs);

      const result = await controller.list();

      expect(result).toBe(jobs);
      expect(jobsService.list).toHaveBeenCalledWith({
        status: undefined,
        limit: undefined,
      });
    });

    it('should pass status filter', async () => {
      jobsService.list.mockResolvedValue([]);

      await controller.list('active');

      expect(jobsService.list).toHaveBeenCalledWith({
        status: 'active',
        limit: undefined,
      });
    });

    it('should pass limit as number', async () => {
      jobsService.list.mockResolvedValue([]);

      await controller.list(undefined, '5');

      expect(jobsService.list).toHaveBeenCalledWith({
        status: undefined,
        limit: 5,
      });
    });

    it('should fallback to undefined for non-numeric limit', async () => {
      jobsService.list.mockResolvedValue([]);

      await controller.list(undefined, 'abc');

      expect(jobsService.list).toHaveBeenCalledWith({
        status: undefined,
        limit: undefined,
      });
    });

    it('should fallback to undefined for negative limit', async () => {
      jobsService.list.mockResolvedValue([]);

      await controller.list(undefined, '-5');

      expect(jobsService.list).toHaveBeenCalledWith({
        status: undefined,
        limit: undefined,
      });
    });
  });

  describe('GET /jobs/:id', () => {
    it('should return job status', async () => {
      const response = new JobResponseDto();
      response.id = 'job-123';
      response.status = 'completed';
      response.target = 'myrepo';
      response.prompt = 'Fix the bug';
      response.createdAt = new Date();

      jobsService.getStatus.mockResolvedValue(response);

      const result = await controller.getStatus('job-123');

      expect(result).toBe(response);
      expect(jobsService.getStatus).toHaveBeenCalledWith('job-123');
    });

    it('should propagate NotFoundException', async () => {
      jobsService.getStatus.mockRejectedValue(
        new NotFoundException('Job not-found not found'),
      );

      await expect(controller.getStatus('not-found')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('DELETE /jobs/:id', () => {
    it('should cancel the job', async () => {
      jobsService.cancel.mockResolvedValue(undefined);

      await controller.cancel('job-123');

      expect(jobsService.cancel).toHaveBeenCalledWith('job-123');
    });

    it('should propagate NotFoundException', async () => {
      jobsService.cancel.mockRejectedValue(
        new NotFoundException('Job not-found not found'),
      );

      await expect(controller.cancel('not-found')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
