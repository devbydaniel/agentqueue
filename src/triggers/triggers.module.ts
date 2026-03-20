import { Module } from '@nestjs/common';
import { ManualModule } from './manual/manual.module.js';
import { CronModule } from './cron/cron.module.js';
import { WebhookModule } from './webhook/webhook.module.js';
import { TriggersController } from './triggers.controller.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { EngineConfigModule } from '../config/config.module.js';

@Module({
  imports: [ManualModule, CronModule, WebhookModule, JobsModule, EngineConfigModule],
  controllers: [TriggersController],
})
export class TriggersModule {}
