import { Module } from '@nestjs/common';
import { ManualModule } from './manual/manual.module.js';
import { CronModule } from './cron/cron.module.js';
import { WebhookModule } from './webhook/webhook.module.js';

@Module({
  imports: [ManualModule, CronModule, WebhookModule],
})
export class TriggersModule {}
