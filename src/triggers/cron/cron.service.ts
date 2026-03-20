import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EngineConfigService } from '../../config/engine-config.service.js';
import { AgentJobData } from '../../jobs/job.interface.js';

@Injectable()
export class CronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CronService.name);

  constructor(
    @InjectQueue('agent-jobs') private readonly queue: Queue,
    private readonly engineConfig: EngineConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Clean up stale schedulers BEFORE registering current ones
    // This handles renamed/removed triggers that survived non-graceful restarts
    await this.cleanupStaleSchedulers();

    const cronTriggers = this.engineConfig.getCronTriggers();

    if (cronTriggers.length === 0) {
      this.logger.log('No cron triggers configured');
      return;
    }

    for (const trigger of cronTriggers) {
      const jobData: AgentJobData = {
        target: trigger.target,
        prompt: trigger.prompt,
        trigger: { type: 'cron', source: trigger.name },
        ...(trigger.before && { before: trigger.before }),
      };

      await this.queue.upsertJobScheduler(
        `cron-${trigger.name}`,
        { pattern: trigger.schedule },
        {
          name: 'agent-job',
          data: jobData,
          opts: {
            attempts: 10,
            backoff: { type: 'exponential', delay: 5000 },
          },
        },
      );

      this.logger.log(
        `Registered cron trigger "${trigger.name}" with schedule "${trigger.schedule}"`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.cleanupStaleSchedulers();
  }

  private async cleanupStaleSchedulers(): Promise<void> {
    const cronTriggers = this.engineConfig.getCronTriggers();
    const configuredKeys = new Set(cronTriggers.map((t) => `cron-${t.name}`));

    try {
      const schedulers = await this.queue.getJobSchedulers();
      for (const scheduler of schedulers) {
        const id = scheduler.id;
        if (!id) continue;
        if (id.startsWith('cron-') && !configuredKeys.has(id)) {
          await this.queue.removeJobScheduler(id);
          this.logger.warn(`Removed stale cron scheduler "${id}" (not in triggers config)`);
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to clean up stale schedulers: ${String(error)}`);
    }
  }
}
