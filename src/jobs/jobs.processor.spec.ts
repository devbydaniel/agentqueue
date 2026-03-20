import { ChildProcess } from 'child_process';
import { JobsProcessor } from './jobs.processor.js';
import { Job, Queue, DelayedError } from 'bullmq';
import { EngineConfigService } from '../config/engine-config.service.js';
import { EventStoreService } from '../events/event-store.service.js';
import { AgentJobData } from './job.interface.js';
import { EventEmitter } from 'events';
import type Redis from 'ioredis';

function createMockStdin(): { end: () => void } {
  return { end: jest.fn() };
}

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
  (child as any).stdin = createMockStdin();
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
  let mockEventStore: {
    append: jest.Mock;
    getAll: jest.Mock;
    stream: jest.Mock;
    expire: jest.Mock;
  };

  beforeEach(() => {
    mockRedis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    };

    mockQueue = {
      client: Promise.resolve(mockRedis),
    } as unknown as Partial<Queue>;

    mockConfigService = {
      lockTtl: 900,
      jobTimeout: 600000,
      beforeHookTimeout: 30000,
    };

    mockEventStore = {
      append: jest.fn().mockResolvedValue(undefined),
      getAll: jest.fn().mockResolvedValue([]),
      stream: jest.fn(),
      expire: jest.fn().mockResolvedValue(undefined),
    };

    processor = new JobsProcessor(
      mockQueue as Queue,
      mockConfigService as EngineConfigService,
      mockEventStore as unknown as EventStoreService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createJob(data: AgentJobData, id = 'job-123'): Job<AgentJobData> {
    return { id, data } as Job<AgentJobData>;
  }

  it('should spawn agentfiles with correct args including --mode json', async () => {
    const child = createMockChildProcess(0, 'job output here');
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'Fix the bug',
      trigger: { type: 'api' },
    });

    const result = await processor.process(job);

    expect(mockedSpawn).toHaveBeenCalledWith(
      'af',
      ['exec', 'myrepo', '--', '--mode', 'json', '-p', 'Fix the bug'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
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

    expect(mockedSpawn).toHaveBeenCalledWith(
      'af',
      [
        'exec',
        'myrepo',
        '--agent',
        'claude',
        '--',
        '--mode',
        'json',
        '-p',
        'Review PR',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
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
    // expire should not be called either
    expect(mockEventStore.expire).not.toHaveBeenCalled();
  });

  it('should handle spawn error event (ENOENT)', async () => {
    const child = new EventEmitter() as ChildProcess;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (child as any).stdin = createMockStdin();
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
    (child as any).stdin = createMockStdin();
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

  it('should write normalized events to event store for valid JSON lines', async () => {
    const jsonLines =
      [
        JSON.stringify({ type: 'turn_start', turn_index: 0 }),
        JSON.stringify({
          type: 'tool_execution_start',
          tool: 'bash',
          args: { command: 'ls' },
        }),
        JSON.stringify({
          type: 'tool_execution_end',
          tool: 'bash',
          is_error: false,
          output: 'file.txt',
        }),
        JSON.stringify({ type: 'agent_end' }),
      ].join('\n') + '\n';

    const child = createMockChildProcess(0, jsonLines);
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    await processor.process(job);

    // Should have 4 append calls for the 4 normalized events
    expect(mockEventStore.append).toHaveBeenCalledTimes(4);
    expect(mockEventStore.append).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({ type: 'turn_start', turnIndex: 0 }),
    );
    expect(mockEventStore.append).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({ type: 'tool_start', tool: 'bash' }),
    );
    expect(mockEventStore.append).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({
        type: 'tool_end',
        tool: 'bash',
        isError: false,
      }),
    );
    expect(mockEventStore.append).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({ type: 'agent_end' }),
    );
  });

  it('should write log events for non-JSON stdout lines', async () => {
    const stdout = 'Starting agent...\nSome raw output\n';
    const child = createMockChildProcess(0, stdout);
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    await processor.process(job);

    expect(mockEventStore.append).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({ type: 'log', text: 'Starting agent...' }),
    );
    expect(mockEventStore.append).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({ type: 'log', text: 'Some raw output' }),
    );
  });

  it('should skip unknown JSON event types (normalizer returns null)', async () => {
    const jsonLines =
      [
        JSON.stringify({ type: 'session', session_id: 'abc' }),
        JSON.stringify({ type: 'toolcall_delta', delta: 'x' }),
        JSON.stringify({ type: 'turn_start', turn_index: 0 }),
      ].join('\n') + '\n';

    const child = createMockChildProcess(0, jsonLines);
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    await processor.process(job);

    // Only turn_start should be appended (session and toolcall_delta are filtered by normalizer)
    expect(mockEventStore.append).toHaveBeenCalledTimes(1);
    expect(mockEventStore.append).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({ type: 'turn_start' }),
    );
  });

  it('should call expire with 86400 after job completes successfully', async () => {
    const child = createMockChildProcess(0, 'done');
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    await processor.process(job);

    expect(mockEventStore.expire).toHaveBeenCalledWith('job-123', 86400);
  });

  it('should call expire with 86400 after job fails', async () => {
    const child = createMockChildProcess(1, '', 'error');
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    await expect(processor.process(job)).rejects.toThrow();

    expect(mockEventStore.expire).toHaveBeenCalledWith('job-123', 86400);
  });

  describe('before hook', () => {
    beforeEach(() => {
      mockedSpawn.mockReset();
    });

    it('should proceed normally when job has no before field', async () => {
      const child = createMockChildProcess(0, 'done');
      mockedSpawn.mockReturnValue(child);

      const job = createJob({
        target: 'myrepo',
        prompt: 'Do the thing',
        trigger: { type: 'api' },
      });

      const result = await processor.process(job);

      expect(result).toEqual({ success: true, output: 'done' });
      // spawn should be called once (the agent, no before hook)
      expect(mockedSpawn).toHaveBeenCalledTimes(1);
      expect(mockedSpawn).toHaveBeenCalledWith(
        'af',
        expect.arrayContaining(['exec', 'myrepo']),
        expect.any(Object),
      );
    });

    it('should replace {{before_output}} in prompt when before hook exits 0 with stdout', async () => {
      mockedSpawn.mockImplementation(() =>
        createMockChildProcess(
          mockedSpawn.mock.calls.length === 1 ? 0 : 0,
          mockedSpawn.mock.calls.length === 1
            ? 'Meeting at 10am\n'
            : 'agent done',
        ),
      );

      const job = createJob({
        target: 'myrepo',
        prompt: 'Prepare for: {{before_output}}',
        trigger: { type: 'cron' },
        before: '/scripts/check.sh',
      });

      const result = await processor.process(job);

      expect(result.success).toBe(true);
      expect(mockedSpawn).toHaveBeenCalledTimes(2);
      // First call: before hook
      expect(mockedSpawn).toHaveBeenNthCalledWith(
        1,
        'sh',
        ['-c', '/scripts/check.sh'],
        expect.any(Object),
      );
      // Second call: agent with substituted prompt
      expect(mockedSpawn).toHaveBeenNthCalledWith(
        2,
        'af',
        expect.arrayContaining(['-p', 'Prepare for: Meeting at 10am']),
        expect.any(Object),
      );
    });

    it('should skip job when before hook exits non-zero', async () => {
      const beforeChild = createMockChildProcess(1, '', 'no meetings');
      mockedSpawn.mockReturnValue(beforeChild);

      const job = createJob({
        target: 'myrepo',
        prompt: 'Prepare for: {{before_output}}',
        trigger: { type: 'cron' },
        before: '/scripts/check.sh',
      });

      const result = await processor.process(job);

      expect(result).toEqual({ success: true, output: 'skipped' });
      // Only the before hook should be spawned, not the agent
      expect(mockedSpawn).toHaveBeenCalledTimes(1);
      expect(mockedSpawn).toHaveBeenCalledWith(
        'sh',
        ['-c', '/scripts/check.sh'],
        expect.any(Object),
      );
      // Should append a skip log event
      expect(mockEventStore.append).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          type: 'log',
          text: 'Skipped by before hook',
        }),
      );
    });

    it('should replace {{before_output}} with empty string when before hook exits 0 with empty stdout', async () => {
      mockedSpawn.mockImplementation(() =>
        createMockChildProcess(
          0,
          mockedSpawn.mock.calls.length === 1 ? '' : 'agent done',
        ),
      );

      const job = createJob({
        target: 'myrepo',
        prompt: 'Info: {{before_output}} end',
        trigger: { type: 'cron' },
        before: '/scripts/check.sh',
      });

      const result = await processor.process(job);

      expect(result.success).toBe(true);
      expect(mockedSpawn).toHaveBeenNthCalledWith(
        2,
        'af',
        expect.arrayContaining(['-p', 'Info:  end']),
        expect.any(Object),
      );
    });

    it('should skip job when before hook times out', async () => {
      // Override beforeHookTimeout to a very short value
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (mockConfigService as any).beforeHookTimeout = 10;

      const child = new EventEmitter() as ChildProcess;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (child as any).stdin = { end: jest.fn() };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (child as any).stdout = new EventEmitter();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (child as any).stderr = new EventEmitter();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (child as any).kill = jest.fn(() => {
        // Simulate SIGTERM causing close with null code
        process.nextTick(() => child.emit('close', null));
      });
      mockedSpawn.mockReturnValue(child);

      const job = createJob({
        target: 'myrepo',
        prompt: 'Prepare: {{before_output}}',
        trigger: { type: 'cron' },
        before: 'sleep 60',
      });

      const result = await processor.process(job);

      expect(result).toEqual({ success: true, output: 'skipped' });
      expect(mockEventStore.append).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          type: 'log',
          text: 'Skipped by before hook',
        }),
      );
    });
  });

  it('should still return raw output string for backward compat with JSON stdout', async () => {
    const line1 = JSON.stringify({ type: 'turn_start', turn_index: 0 });
    const line2 = JSON.stringify({ type: 'agent_end' });
    const stdout = line1 + '\n' + line2 + '\n';

    const child = createMockChildProcess(0, stdout);
    mockedSpawn.mockReturnValue(child);

    const job = createJob({
      target: 'myrepo',
      prompt: 'test',
      trigger: { type: 'api' },
    });

    const result = await processor.process(job);
    expect(result.output).toBe(stdout);
  });
});
