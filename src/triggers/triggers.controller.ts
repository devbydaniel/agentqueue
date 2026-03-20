import { Controller, Get } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EngineConfigService } from '../config/engine-config.service.js';

export interface TriggerStatusDto {
  name: string;
  type: string;
  target: string;
  schedule?: string;
  schedulerId: string;
  status: 'active' | 'stale';
  nextRun?: string;
}

@Controller('triggers')
export class TriggersController {
  constructor(
    @InjectQueue('agent-jobs') private readonly queue: Queue,
    private readonly configService: EngineConfigService,
  ) {}

  @Get()
  async list(): Promise<TriggerStatusDto[]> {
    const cronTriggers = this.configService.getCronTriggers();
    const configuredKeys = new Map(
      cronTriggers.map((t) => [`cron-${t.name}`, t]),
    );

    const schedulers = await this.queue.getJobSchedulers();
    const result: TriggerStatusDto[] = [];

    // Map all schedulers (configured + stale)
    for (const scheduler of schedulers) {
      if (!scheduler) continue;
      const raw = scheduler as unknown as Record<string, unknown>;
      const id = (raw.key as string) ?? (raw.id as string);
      if (!id || !id.startsWith('cron-')) continue;

      const trigger = configuredKeys.get(id);
      const next = scheduler.next
        ? new Date(Number(scheduler.next)).toISOString()
        : undefined;

      if (trigger) {
        result.push({
          name: trigger.name,
          type: 'cron',
          target: trigger.target,
          schedule: trigger.schedule,
          schedulerId: id,
          status: 'active',
          nextRun: next,
        });
        configuredKeys.delete(id);
      } else {
        result.push({
          name: id.replace(/^cron-/, ''),
          type: 'cron',
          target: '(unknown)',
          schedulerId: id,
          status: 'stale',
          nextRun: next,
        });
      }
    }

    // Configured triggers without a scheduler (not yet registered)
    for (const [key, trigger] of configuredKeys) {
      result.push({
        name: trigger.name,
        type: 'cron',
        target: trigger.target,
        schedule: trigger.schedule,
        schedulerId: key,
        status: 'active',
        nextRun: undefined,
      });
    }

    // Sort: stale first, then by name
    result.sort((a, b) => {
      if (a.status !== b.status)
        return a.status === 'stale' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }
}
