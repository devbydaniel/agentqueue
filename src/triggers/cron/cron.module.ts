import { Module } from '@nestjs/common';
import { JobsModule } from '../../jobs/jobs.module.js';
import { EngineConfigModule } from '../../config/config.module.js';
import { CronService } from './cron.service.js';

@Module({
  imports: [JobsModule, EngineConfigModule],
  providers: [CronService],
})
export class CronModule {}
