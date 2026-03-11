import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EngineConfigService } from './engine-config.service.js';

@Module({
  imports: [ConfigModule],
  providers: [EngineConfigService],
  exports: [EngineConfigService],
})
export class EngineConfigModule {}
