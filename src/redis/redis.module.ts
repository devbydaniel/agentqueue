import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import type Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_OPTIONS = 'REDIS_OPTIONS';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_OPTIONS,
      useFactory: (configService: ConfigService): RedisOptions => ({
        host: configService.get<string>('REDIS_HOST', 'localhost'),
        port: configService.get<number>('REDIS_PORT', 6379),
      }),
      inject: [ConfigService],
    },
    {
      provide: REDIS_CLIENT,
      useFactory: (options: RedisOptions): Redis => new IORedis(options),
      inject: [REDIS_OPTIONS],
    },
  ],
  exports: [REDIS_CLIENT, REDIS_OPTIONS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
