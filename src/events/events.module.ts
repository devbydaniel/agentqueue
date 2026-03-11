import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { EventStoreService } from './event-store.service.js';

@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        return new IORedis({
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        });
      },
      inject: [ConfigService],
    },
    EventStoreService,
  ],
  exports: [EventStoreService],
})
export class EventsModule {}
