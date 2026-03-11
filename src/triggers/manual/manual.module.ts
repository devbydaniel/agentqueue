import { Module } from '@nestjs/common';
import { JobsModule } from '../../jobs/jobs.module.js';
import { ManualController } from './manual.controller.js';

@Module({
  imports: [JobsModule],
  controllers: [ManualController],
})
export class ManualModule {}
