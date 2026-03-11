import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EngineConfigService } from './engine-config.service.js';
import * as yaml from 'js-yaml';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('EngineConfigService', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentqueue-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createService(
    envOverrides: Record<string, any> = {},
  ): Promise<EngineConfigService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngineConfigService,
        {
          provide: ConfigService,
          useValue: {
            get: <T>(key: string, defaultValue?: T): T | undefined => {
              if (key in envOverrides) return envOverrides[key] as T;
              return defaultValue;
            },
          },
        },
      ],
    }).compile();

    return module.get<EngineConfigService>(EngineConfigService);
  }

  it('should load valid YAML with cron trigger', async () => {
    const configPath = join(tmpDir, 'triggers.yaml');
    const config = {
      triggers: [
        {
          name: 'daily-review',
          type: 'cron',
          schedule: '0 8 * * *',
          target: 'assistant',
          prompt: 'Run morning review',
        },
      ],
    };
    writeFileSync(configPath, yaml.dump(config));

    const service = await createService({ TRIGGERS_CONFIG_PATH: configPath });
    const triggers = service.getTriggers();

    expect(triggers).toHaveLength(1);
    expect(triggers[0].name).toBe('daily-review');
    expect(triggers[0].type).toBe('cron');

    const cronTriggers = service.getCronTriggers();
    expect(cronTriggers).toHaveLength(1);
    expect(cronTriggers[0].schedule).toBe('0 8 * * *');
  });

  it('should load valid YAML with webhook trigger', async () => {
    const configPath = join(tmpDir, 'triggers.yaml');
    const config = {
      triggers: [
        {
          name: 'pr-review',
          type: 'webhook',
          source: 'github',
          events: ['pull_request.opened'],
          target: 'myrepo',
          prompt: 'Review PR',
        },
      ],
    };
    writeFileSync(configPath, yaml.dump(config));

    const service = await createService({ TRIGGERS_CONFIG_PATH: configPath });
    const webhookTriggers = service.getWebhookTriggers();

    expect(webhookTriggers).toHaveLength(1);
    expect(webhookTriggers[0].source).toBe('github');
    expect(webhookTriggers[0].events).toEqual(['pull_request.opened']);
  });

  it('should return empty triggers when file does not exist', async () => {
    const service = await createService({
      TRIGGERS_CONFIG_PATH: join(tmpDir, 'nonexistent.yaml'),
    });

    expect(service.getTriggers()).toEqual([]);
    expect(service.getCronTriggers()).toEqual([]);
    expect(service.getWebhookTriggers()).toEqual([]);
  });

  it('should filter out triggers missing required fields', async () => {
    const configPath = join(tmpDir, 'triggers.yaml');
    const config = {
      triggers: [
        {
          name: 'valid',
          type: 'cron',
          schedule: '0 * * * *',
          target: 'x',
          prompt: 'y',
        },
        { name: 'no-target', type: 'cron', schedule: '0 * * * *', prompt: 'y' },
        { name: 'no-prompt', type: 'cron', schedule: '0 * * * *', target: 'x' },
        { type: 'cron', schedule: '0 * * * *', target: 'x', prompt: 'y' },
      ],
    };
    writeFileSync(configPath, yaml.dump(config));

    const service = await createService({ TRIGGERS_CONFIG_PATH: configPath });
    expect(service.getTriggers()).toHaveLength(1);
    expect(service.getTriggers()[0].name).toBe('valid');
  });

  it('should reject cron trigger without schedule', async () => {
    const configPath = join(tmpDir, 'triggers.yaml');
    const config = {
      triggers: [{ name: 'bad-cron', type: 'cron', target: 'x', prompt: 'y' }],
    };
    writeFileSync(configPath, yaml.dump(config));

    const service = await createService({ TRIGGERS_CONFIG_PATH: configPath });
    expect(service.getTriggers()).toHaveLength(0);
  });

  it('should reject webhook trigger without source or events', async () => {
    const configPath = join(tmpDir, 'triggers.yaml');
    const config = {
      triggers: [
        {
          name: 'no-source',
          type: 'webhook',
          events: ['push'],
          target: 'x',
          prompt: 'y',
        },
        {
          name: 'no-events',
          type: 'webhook',
          source: 'github',
          target: 'x',
          prompt: 'y',
        },
      ],
    };
    writeFileSync(configPath, yaml.dump(config));

    const service = await createService({ TRIGGERS_CONFIG_PATH: configPath });
    expect(service.getTriggers()).toHaveLength(0);
  });

  it('should expose config values with defaults', async () => {
    const service = await createService({
      TRIGGERS_CONFIG_PATH: join(tmpDir, 'nonexistent.yaml'),
    });

    expect(service.workerConcurrency).toBe(3);
    expect(service.jobTimeout).toBe(600000);
    expect(service.lockTtl).toBe(900);
  });

  it('should expose overridden config values', async () => {
    const service = await createService({
      TRIGGERS_CONFIG_PATH: join(tmpDir, 'nonexistent.yaml'),
      WORKER_CONCURRENCY: 5,
      JOB_TIMEOUT: 300000,
      LOCK_TTL: 600,
    });

    expect(service.workerConcurrency).toBe(5);
    expect(service.jobTimeout).toBe(300000);
    expect(service.lockTtl).toBe(600);
  });

  it('should coerce string env values to numbers', async () => {
    const service = await createService({
      TRIGGERS_CONFIG_PATH: join(tmpDir, 'nonexistent.yaml'),
      WORKER_CONCURRENCY: '10',
      JOB_TIMEOUT: '500000',
      LOCK_TTL: '1200',
    });

    expect(service.workerConcurrency).toBe(10);
    expect(service.jobTimeout).toBe(500000);
    expect(service.lockTtl).toBe(1200);
  });

  it('should handle empty triggers list', async () => {
    const configPath = join(tmpDir, 'triggers.yaml');
    writeFileSync(configPath, yaml.dump({ triggers: [] }));

    const service = await createService({ TRIGGERS_CONFIG_PATH: configPath });
    expect(service.getTriggers()).toEqual([]);
  });

  it('should handle malformed YAML syntax gracefully', async () => {
    const configPath = join(tmpDir, 'triggers.yaml');
    writeFileSync(configPath, ':\n  - :\n  invalid: [unbalanced\n');

    const service = await createService({ TRIGGERS_CONFIG_PATH: configPath });
    expect(service.getTriggers()).toEqual([]);
  });

  it('should handle YAML with null triggers', async () => {
    const configPath = join(tmpDir, 'triggers.yaml');
    writeFileSync(configPath, 'triggers: null\n');

    const service = await createService({ TRIGGERS_CONFIG_PATH: configPath });
    expect(service.getTriggers()).toEqual([]);
  });
});
