import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EngineConfigModule } from '../config/config.module.js';
import { EventsModule } from '../events/events.module.js';
import { JobsService } from './jobs.service.js';
import { JobsProcessor } from './jobs.processor.js';

@Module({
  imports: [
    EngineConfigModule,
    EventsModule,
    BullModule.registerQueue({
      name: 'agent-jobs',
    }),
  ],
  providers: [JobsService, JobsProcessor],
  exports: [JobsService, BullModule],
})
export class JobsModule {}
