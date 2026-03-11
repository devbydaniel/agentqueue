import { Module } from '@nestjs/common';
import { JobsModule } from '../../jobs/jobs.module.js';
import { EngineConfigModule } from '../../config/config.module.js';
import { WebhookController } from './webhook.controller.js';

@Module({
  imports: [JobsModule, EngineConfigModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
