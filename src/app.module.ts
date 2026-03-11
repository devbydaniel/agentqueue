import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import type { RedisOptions } from 'ioredis';
import { EngineConfigModule } from './config/config.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { TriggersModule } from './triggers/triggers.module.js';
import { EventsModule } from './events/events.module.js';
import { RedisModule, REDIS_OPTIONS } from './redis/redis.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    RedisModule,
    BullModule.forRootAsync({
      useFactory: (redisOptions: RedisOptions) => ({
        connection: redisOptions,
      }),
      inject: [REDIS_OPTIONS],
    }),
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'agent-jobs',
      adapter: BullMQAdapter,
    }),
    EngineConfigModule,
    JobsModule,
    TriggersModule,
    EventsModule,
  ],
})
export class AppModule {}
