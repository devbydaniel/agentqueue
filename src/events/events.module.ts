import { Module } from '@nestjs/common';
import { EventStoreService } from './event-store.service.js';
import { EventsController } from './events.controller.js';

@Module({
  controllers: [EventsController],
  providers: [EventStoreService],
  exports: [EventStoreService],
})
export class EventsModule {}
