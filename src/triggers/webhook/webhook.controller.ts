import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import * as Handlebars from 'handlebars';
import type { Request } from 'express';
import { JobsService } from '../../jobs/jobs.service.js';
import { EngineConfigService } from '../../config/engine-config.service.js';
import { AgentJobData } from '../../jobs/job.interface.js';
import { matchesFilters } from './webhook-filter.js';

const SAFE_TARGET_PATTERN = /^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)?$/;
const MAX_PROMPT_LENGTH = 10_000;

@Controller('webhooks')
export class WebhookController implements OnModuleInit {
  private readonly logger = new Logger(WebhookController.name);
  private templateCache = new Map<
    string,
    HandlebarsTemplateDelegate<unknown>
  >();

  constructor(
    private readonly jobsService: JobsService,
    private readonly engineConfig: EngineConfigService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const triggers = this.engineConfig.getWebhookTriggers();
    for (const trigger of triggers) {
      this.templateCache.set(
        `target:${trigger.name}`,
        Handlebars.compile(trigger.target),
      );
      this.templateCache.set(
        `prompt:${trigger.name}`,
        Handlebars.compile(trigger.prompt),
      );
    }
  }

  private getTemplate(
    key: string,
    template: string,
  ): HandlebarsTemplateDelegate<unknown> {
    let compiled = this.templateCache.get(key);
    if (!compiled) {
      compiled = Handlebars.compile(template);
      this.templateCache.set(key, compiled);
    }
    return compiled;
  }

  @Post(':source')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('source') source: string,
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<{ jobIds: string[] }> {
    const secret = this.configService.get<string>('GITHUB_WEBHOOK_SECRET');
    if (secret) {
      this.verifySignature(req, secret);
    }

    const eventType =
      (headers['x-github-event'] as string | undefined) ??
      (headers['x-event-type'] as string | undefined) ??
      'unknown';

    const webhookTriggers = this.engineConfig.getWebhookTriggers();
    const matching = webhookTriggers.filter(
      (t) =>
        t.source === source &&
        t.events.includes(eventType) &&
        matchesFilters(body, t.filters),
    );

    if (matching.length === 0) {
      this.logger.debug(
        `No triggers matched source="${source}" event="${eventType}"`,
      );
      return { jobIds: [] };
    }

    const jobIds: string[] = [];
    for (const trigger of matching) {
      const targetTemplate = this.getTemplate(
        `target:${trigger.name}`,
        trigger.target,
      );
      const promptTemplate = this.getTemplate(
        `prompt:${trigger.name}`,
        trigger.prompt,
      );

      const renderedTarget = targetTemplate(body);
      const renderedPrompt = promptTemplate(body);

      if (!SAFE_TARGET_PATTERN.test(renderedTarget)) {
        throw new BadRequestException(
          `Rendered target "${renderedTarget}" contains invalid characters`,
        );
      }

      if (renderedPrompt.length > MAX_PROMPT_LENGTH) {
        throw new BadRequestException(
          `Rendered prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`,
        );
      }

      const data: AgentJobData = {
        target: renderedTarget,
        prompt: renderedPrompt,
        trigger: { type: 'webhook', source: trigger.name },
        ...(trigger.agent && { agent: trigger.agent }),
        ...(trigger.before && { before: trigger.before }),
      };

      const id = await this.jobsService.enqueue(data);
      jobIds.push(id);

      this.logger.log(
        `Enqueued job ${id} from webhook trigger "${trigger.name}" (event: ${eventType})`,
      );
    }

    return { jobIds };
  }

  private verifySignature(req: Request, secret: string): void {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!signature) {
      throw new ForbiddenException('Missing webhook signature');
    }

    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      throw new ForbiddenException(
        'Raw body not available for signature verification',
      );
    }

    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException('Invalid webhook signature');
    }
  }
}
