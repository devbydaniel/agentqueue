import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WebhookController } from './webhook.controller.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { EngineConfigService } from '../../config/engine-config.service.js';
import { WebhookTrigger } from '../../config/trigger-config.interface.js';

describe('WebhookController', () => {
  let controller: WebhookController;
  let jobsService: Record<string, jest.Mock>;
  let engineConfig: Record<string, jest.Mock>;
  let configService: Record<string, jest.Mock>;

  const sampleTriggers: WebhookTrigger[] = [
    {
      name: 'github-push',
      type: 'webhook',
      source: 'github',
      events: ['push'],
      target: '{{repository.full_name}}',
      prompt: 'Review push to {{ref}}',
    },
    {
      name: 'github-pr',
      type: 'webhook',
      source: 'github',
      events: ['pull_request'],
      target: '{{repository.full_name}}',
      prompt: 'Review PR #{{pull_request.number}}',
    },
    {
      name: 'other-push',
      type: 'webhook',
      source: 'gitlab',
      events: ['push'],
      target: 'some-repo',
      prompt: 'Handle push',
    },
  ];

  beforeEach(async () => {
    jobsService = {
      enqueue: jest.fn().mockResolvedValue('job-001'),
    };

    engineConfig = {
      getWebhookTriggers: jest.fn().mockReturnValue(sampleTriggers),
    };

    configService = {
      get: jest.fn().mockReturnValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: JobsService, useValue: jobsService },
        { provide: EngineConfigService, useValue: engineConfig },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
    controller.onModuleInit();
  });

  function makeReq(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      headers: {},
      ...overrides,
    };
  }

  describe('matching triggers by source and event', () => {
    it('should match correct trigger by source and event type', async () => {
      const body = {
        repository: { full_name: 'owner/repo' },
        ref: 'refs/heads/main',
      };

      const result = await controller.handleWebhook(
        'github',
        { 'x-github-event': 'push' },
        body,
        makeReq() as never,
      );

      expect(result).toEqual({ jobIds: ['job-001'] });
      expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
      expect(jobsService.enqueue).toHaveBeenCalledWith({
        target: 'owner/repo',
        prompt: 'Review push to refs/heads/main',
        trigger: { type: 'webhook', source: 'github-push' },
      });
    });

    it('should not match triggers with different source', async () => {
      const req = makeReq();
      const result = await controller.handleWebhook(
        'gitlab',
        { 'x-github-event': 'push' },
        {},
        req as never,
      );

      // gitlab + push matches 'other-push'
      expect(result).toEqual({ jobIds: ['job-001'] });
      expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('Handlebars template rendering', () => {
    it('should render target and prompt templates with request body', async () => {
      const body = {
        repository: { full_name: 'acme/project' },
        pull_request: { number: 42 },
      };

      await controller.handleWebhook(
        'github',
        { 'x-github-event': 'pull_request' },
        body,
        makeReq() as never,
      );

      expect(jobsService.enqueue).toHaveBeenCalledWith({
        target: 'acme/project',
        prompt: 'Review PR #42',
        trigger: { type: 'webhook', source: 'github-pr' },
      });
    });
  });

  describe('unmatched events', () => {
    it('should return empty jobIds when no triggers match', async () => {
      const req = makeReq();
      const result = await controller.handleWebhook(
        'github',
        { 'x-github-event': 'release' },
        {},
        req as never,
      );

      expect(result).toEqual({ jobIds: [] });
      expect(jobsService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('payload filters', () => {
    it('should match when all filters pass', async () => {
      const triggers: WebhookTrigger[] = [
        {
          name: 'pr-review',
          type: 'webhook',
          source: 'github',
          events: ['pull_request'],
          filters: [
            { field: 'action', equals: 'review_requested' },
            { field: 'requested_reviewer.login', equals: 'my-bot' },
          ],
          target: '{{repository.name}}',
          prompt: 'Review PR #{{pull_request.number}}',
        },
      ];
      engineConfig.getWebhookTriggers.mockReturnValue(triggers);
      controller.onModuleInit();

      const body = {
        action: 'review_requested',
        requested_reviewer: { login: 'my-bot' },
        repository: { name: 'my-repo' },
        pull_request: { number: 7 },
      };

      const result = await controller.handleWebhook(
        'github',
        { 'x-github-event': 'pull_request' },
        body,
        makeReq() as never,
      );

      expect(result).toEqual({ jobIds: ['job-001'] });
      expect(jobsService.enqueue).toHaveBeenCalledWith({
        target: 'my-repo',
        prompt: 'Review PR #7',
        trigger: { type: 'webhook', source: 'pr-review' },
      });
    });

    it('should not match when a filter fails', async () => {
      const triggers: WebhookTrigger[] = [
        {
          name: 'pr-review',
          type: 'webhook',
          source: 'github',
          events: ['pull_request'],
          filters: [
            { field: 'action', equals: 'review_requested' },
            { field: 'requested_reviewer.login', equals: 'my-bot' },
          ],
          target: 'some-repo',
          prompt: 'Review PR',
        },
      ];
      engineConfig.getWebhookTriggers.mockReturnValue(triggers);
      controller.onModuleInit();

      const body = {
        action: 'opened', // wrong action
        requested_reviewer: { login: 'my-bot' },
        repository: { name: 'my-repo' },
      };

      const result = await controller.handleWebhook(
        'github',
        { 'x-github-event': 'pull_request' },
        body,
        makeReq() as never,
      );

      expect(result).toEqual({ jobIds: [] });
      expect(jobsService.enqueue).not.toHaveBeenCalled();
    });

    it('should match when no filters are defined (backward compat)', async () => {
      const result = await controller.handleWebhook(
        'github',
        { 'x-github-event': 'push' },
        { repository: { full_name: 'owner/repo' }, ref: 'main' },
        makeReq() as never,
      );

      expect(result).toEqual({ jobIds: ['job-001'] });
    });

    it('should include agent in job data when trigger has agent', async () => {
      const triggers: WebhookTrigger[] = [
        {
          name: 'pr-review',
          type: 'webhook',
          source: 'github',
          events: ['pull_request'],
          filters: [{ field: 'action', equals: 'opened' }],
          target: 'my-repo',
          agent: 'reviewer',
          prompt: 'Review PR',
        },
      ];
      engineConfig.getWebhookTriggers.mockReturnValue(triggers);
      controller.onModuleInit();

      await controller.handleWebhook(
        'github',
        { 'x-github-event': 'pull_request' },
        { action: 'opened' },
        makeReq() as never,
      );

      expect(jobsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'reviewer' }),
      );
    });
  });

  describe('multiple matching triggers', () => {
    it('should enqueue multiple jobs if multiple triggers match', async () => {
      const triggers: WebhookTrigger[] = [
        {
          name: 'trigger-a',
          type: 'webhook',
          source: 'github',
          events: ['push'],
          target: 'repo-a',
          prompt: 'Prompt A',
        },
        {
          name: 'trigger-b',
          type: 'webhook',
          source: 'github',
          events: ['push'],
          target: 'repo-b',
          prompt: 'Prompt B',
        },
      ];
      engineConfig.getWebhookTriggers.mockReturnValue(triggers);
      controller.onModuleInit();

      jobsService.enqueue
        .mockResolvedValueOnce('job-001')
        .mockResolvedValueOnce('job-002');

      const result = await controller.handleWebhook(
        'github',
        { 'x-github-event': 'push' },
        {},
        makeReq() as never,
      );

      expect(result).toEqual({ jobIds: ['job-001', 'job-002'] });
      expect(jobsService.enqueue).toHaveBeenCalledTimes(2);
    });
  });

  describe('target validation', () => {
    it('should reject rendered targets with invalid characters', async () => {
      const triggers: WebhookTrigger[] = [
        {
          name: 'bad-target',
          type: 'webhook',
          source: 'github',
          events: ['push'],
          target: '{{payload}}',
          prompt: 'Do something',
        },
      ];
      engineConfig.getWebhookTriggers.mockReturnValue(triggers);
      controller.onModuleInit();

      const body = { payload: 'some/path; rm -rf /' };

      await expect(
        controller.handleWebhook(
          'github',
          { 'x-github-event': 'push' },
          body,
          makeReq() as never,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(jobsService.enqueue).not.toHaveBeenCalled();
    });

    it('should accept valid rendered targets', async () => {
      const triggers: WebhookTrigger[] = [
        {
          name: 'good-target',
          type: 'webhook',
          source: 'github',
          events: ['push'],
          target: '{{owner}}/{{repo}}',
          prompt: 'Do something',
        },
      ];
      engineConfig.getWebhookTriggers.mockReturnValue(triggers);
      controller.onModuleInit();

      const body = { owner: 'acme', repo: 'my-project.v2' };

      const result = await controller.handleWebhook(
        'github',
        { 'x-github-event': 'push' },
        body,
        makeReq() as never,
      );

      expect(result).toEqual({ jobIds: ['job-001'] });
    });
  });

  describe('prompt length validation', () => {
    it('should reject prompts exceeding max length', async () => {
      const triggers: WebhookTrigger[] = [
        {
          name: 'long-prompt',
          type: 'webhook',
          source: 'github',
          events: ['push'],
          target: 'safe-target',
          prompt: '{{payload}}',
        },
      ];
      engineConfig.getWebhookTriggers.mockReturnValue(triggers);
      controller.onModuleInit();

      const body = { payload: 'x'.repeat(10_001) };

      await expect(
        controller.handleWebhook(
          'github',
          { 'x-github-event': 'push' },
          body,
          makeReq() as never,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(jobsService.enqueue).not.toHaveBeenCalled();
    });

    it('should accept prompts within max length', async () => {
      const triggers: WebhookTrigger[] = [
        {
          name: 'ok-prompt',
          type: 'webhook',
          source: 'github',
          events: ['push'],
          target: 'safe-target',
          prompt: '{{payload}}',
        },
      ];
      engineConfig.getWebhookTriggers.mockReturnValue(triggers);
      controller.onModuleInit();

      const body = { payload: 'x'.repeat(10_000) };

      const result = await controller.handleWebhook(
        'github',
        { 'x-github-event': 'push' },
        body,
        makeReq() as never,
      );

      expect(result).toEqual({ jobIds: ['job-001'] });
    });
  });

  describe('signature verification', () => {
    const secret = 'test-secret';

    beforeEach(() => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'GITHUB_WEBHOOK_SECRET') return secret;
        return undefined;
      });
    });

    it('should reject requests with missing signature', async () => {
      const req = makeReq({ headers: {} });

      await expect(
        controller.handleWebhook(
          'github',
          { 'x-github-event': 'push' },
          {},
          req as never,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject requests with invalid signature', async () => {
      const rawBody = Buffer.from('{"test": true}');
      const req = makeReq({
        headers: { 'x-hub-signature-256': 'sha256=invalid' },
        rawBody,
      });

      await expect(
        controller.handleWebhook(
          'github',
          { 'x-github-event': 'push' },
          { test: true },
          req as never,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should accept requests with valid signature', async () => {
      const rawBody = Buffer.from(
        '{"repository":{"full_name":"owner/repo"},"ref":"main"}',
      );
      const hmac = createHmac('sha256', secret).update(rawBody).digest('hex');
      const req = makeReq({
        headers: { 'x-hub-signature-256': `sha256=${hmac}` },
        rawBody,
      });

      const body = { repository: { full_name: 'owner/repo' }, ref: 'main' };

      const result = await controller.handleWebhook(
        'github',
        { 'x-github-event': 'push' },
        body,
        req as never,
      );

      expect(result).toEqual({ jobIds: ['job-001'] });
    });
  });
});
