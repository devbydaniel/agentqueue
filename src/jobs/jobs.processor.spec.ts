import { ChildProcess } from 'child_process';
import { JobsProcessor } from './jobs.processor.js';
import { Job, Queue, DelayedError } from 'bullmq';
import { EngineConfigService } from '../config/engine-config.service.js';
import { AgentJobData } from './job.interface.js';
import { EventEmitter } from 'events';
import type Redis from 'ioredis';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createMockChildProcess(
  exitCode: number,
  stdout: string,
  stderr = '',
): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (child as any).stdout = new EventEmitter();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (child as any).stderr = new EventEmitter();

  // Emit data and close on next tick
  process.nextTick(() => {
    if (stdout) child.stdout!.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr!.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  });

  return child;
}

describe('JobsProcessor', () => {
  let processor: JobsProcessor;
  let mockRedis: Partial<Redis>;
  let mockQueue: Partial<Queue>;
  let mockConfigService: Partial<EngineConfigService>;

  beforeEach(() => {
    mockRedis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    };

    mockQueue = {
      client: Promise.resolve(mockRedis as Redis),
    };

    mockConfigService = {
      lockTtl: 900,
      jobTimeout: 600000,
    };

    processor = new JobsProcessor(
      mockQueue as Queue,
      mockConfigService as EngineConfigService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createJob(data: AgentJobData, id = 'job-123'): Job<AgentJobData> {
    return { id, data } as Job<AgentJobData>;
  }

  it('should spawn agentfiles with correct args for a basic job', async () => {
    const child = createMockChildProcess(0, 'job output here');
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'Fix the bug',
      trigger: { type: 'api' },
    });

    const result = await processor.process(job);

    expect(mockedSpawn).toHaveBeenCalledWith('agentfiles', [
      'exec',
      'myrepo',
      '--',
      '-p',
      'Fix the bug',
    ]);
    expect(result).toEqual({ success: true, output: 'job output here' });
  });

  it('should include --agent flag when agent is set', async () => {
    const child = createMockChildProcess(0, 'done');
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'Review PR',
      trigger: { type: 'webhook', source: 'github' },
      agent: 'claude',
    });

    await processor.process(job);

    expect(mockedSpawn).toHaveBeenCalledWith('agentfiles', [
      'exec',
      'myrepo',
      '--agent',
      'claude',
      '--',
      '-p',
      'Review PR',
    ]);
  });

  it('should throw when process exits with non-zero code', async () => {
    const child = createMockChildProcess(1, '', 'error output');
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    await expect(processor.process(job)).rejects.toThrow(
      'Process exited with code 1: error output',
    );
  });

  it('should throw DelayedError when lock is held', async () => {
    (mockRedis.set as jest.Mock).mockResolvedValue(null);

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    await expect(processor.process(job)).rejects.toThrow(DelayedError);
  });

  it('should release lock atomically after successful job', async () => {
    const child = createMockChildProcess(0, 'done');
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    await processor.process(job);

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get"'),
      1,
      'agent-lock:myrepo',
      'job-123',
    );
  });

  it('should release lock atomically after failed job', async () => {
    const child = createMockChildProcess(1, '', 'error');
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    await expect(processor.process(job)).rejects.toThrow();
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("del"'),
      1,
      'agent-lock:myrepo',
      'job-123',
    );
  });

  it('should not release lock on lock contention (DelayedError)', async () => {
    (mockRedis.set as jest.Mock).mockResolvedValue(null);

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    await expect(processor.process(job)).rejects.toThrow(DelayedError);
    // Lock was never acquired, so eval should not be called
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('should handle spawn error event (ENOENT)', async () => {
    const child = new EventEmitter() as ChildProcess;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (child as any).stdout = new EventEmitter();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (child as any).stderr = new EventEmitter();
    mockedSpawn.mockReturnValue(child);

    process.nextTick(() => {
      child.emit('error', new Error('spawn agentfiles ENOENT'));
    });

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    await expect(processor.process(job)).rejects.toThrow(
      'Failed to spawn process: spawn agentfiles ENOENT',
    );
    expect(mockRedis.eval).toHaveBeenCalled();
  });

  it('should truncate output beyond 100KB', async () => {
    const child = new EventEmitter() as ChildProcess;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (child as any).stdout = new EventEmitter();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (child as any).stderr = new EventEmitter();
    mockedSpawn.mockReturnValue(child);

    const largeChunk = 'x'.repeat(120 * 1024); // 120KB

    process.nextTick(() => {
      child.stdout!.emit('data', Buffer.from(largeChunk));
      child.emit('close', 0);
    });

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    const result = await processor.process(job);
    expect(result.output.length).toBe(100 * 1024);
    // Should keep the tail (last 100KB)
    expect(result.output).toBe(largeChunk.slice(-100 * 1024));
  });
});
