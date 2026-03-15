import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync } from 'fs';
import * as yaml from 'js-yaml';
import {
  TriggerConfig,
  TriggersFile,
  CronTrigger,
  WebhookTrigger,
  WebhookFilter,
} from './trigger-config.interface.js';

@Injectable()
export class EngineConfigService {
  private readonly logger = new Logger(EngineConfigService.name);
  private readonly triggers: TriggerConfig[];

  constructor(private readonly configService: ConfigService) {
    this.triggers = this.loadTriggers();
  }

  get workerConcurrency(): number {
    return Number(this.configService.get<number>('WORKER_CONCURRENCY', 3));
  }

  get jobTimeout(): number {
    return Number(this.configService.get<number>('JOB_TIMEOUT', 600000));
  }

  get lockTtl(): number {
    return Number(this.configService.get<number>('LOCK_TTL', 900));
  }

  getTriggers(): TriggerConfig[] {
    return this.triggers;
  }

  getCronTriggers(): CronTrigger[] {
    return this.triggers.filter((t): t is CronTrigger => t.type === 'cron');
  }

  getWebhookTriggers(): WebhookTrigger[] {
    return this.triggers.filter(
      (t): t is WebhookTrigger => t.type === 'webhook',
    );
  }

  private loadTriggers(): TriggerConfig[] {
    const configPath = this.configService.get<string>(
      'TRIGGERS_CONFIG_PATH',
      './config/triggers.yaml',
    );

    if (!configPath || !existsSync(configPath)) {
      this.logger.warn(
        `Triggers config not found at ${configPath}, using empty triggers`,
      );
      return [];
    }

    try {
      const content = readFileSync(configPath, 'utf-8');
      const parsed = yaml.load(content) as TriggersFile | null;

      if (!parsed || !parsed.triggers) {
        return [];
      }

      const validated = (
        parsed.triggers as unknown as Record<string, unknown>[]
      ).filter((t) => this.validateTrigger(t));
      this.logger.log(
        `Loaded ${validated.length} trigger(s) from ${configPath}`,
      );
      return validated as unknown as TriggerConfig[];
    } catch (error) {
      this.logger.error(`Failed to load triggers config: ${String(error)}`);
      return [];
    }
  }

  private validateTrigger(trigger: Record<string, unknown>): boolean {
    const name = trigger['name'] as string | undefined;
    const type = trigger['type'] as string | undefined;
    const target = trigger['target'] as string | undefined;
    const prompt = trigger['prompt'] as string | undefined;

    if (!name || !type || !target || !prompt) {
      this.logger.warn(
        `Trigger missing required fields (name, type, target, prompt): ${JSON.stringify(trigger)}`,
      );
      return false;
    }

    if (type === 'cron' && !trigger['schedule']) {
      this.logger.warn(`Cron trigger "${name}" missing schedule`);
      return false;
    }

    if (type === 'webhook') {
      if (!trigger['source']) {
        this.logger.warn(`Webhook trigger "${name}" missing source`);
        return false;
      }
      if (!trigger['events'] || !Array.isArray(trigger['events'])) {
        this.logger.warn(`Webhook trigger "${name}" missing events array`);
        return false;
      }
      if (trigger['filters'] !== undefined) {
        if (!Array.isArray(trigger['filters'])) {
          this.logger.warn(
            `Webhook trigger "${name}" filters must be an array`,
          );
          return false;
        }
        for (const filter of trigger['filters'] as WebhookFilter[]) {
          if (!filter.field || typeof filter.field !== 'string') {
            this.logger.warn(
              `Webhook trigger "${name}" has a filter missing "field"`,
            );
            return false;
          }
          const hasCondition =
            filter.equals !== undefined ||
            filter.contains !== undefined ||
            filter.in !== undefined ||
            filter.pattern !== undefined;
          if (!hasCondition) {
            this.logger.warn(
              `Webhook trigger "${name}" filter on "${filter.field}" has no condition (equals, contains, in, pattern)`,
            );
            return false;
          }
          if (filter.pattern !== undefined) {
            try {
              new RegExp(filter.pattern);
            } catch {
              this.logger.warn(
                `Webhook trigger "${name}" filter on "${filter.field}" has invalid regex: ${filter.pattern}`,
              );
              return false;
            }
          }
        }
      }
    }

    if (type !== 'cron' && type !== 'webhook') {
      this.logger.warn(`Unknown trigger type "${type}" for "${name}"`);
      return false;
    }

    return true;
  }
}
