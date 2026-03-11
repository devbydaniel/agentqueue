import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { EngineConfigService } from './config/engine-config.service.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const engineConfig = app.get(EngineConfigService);
  const port = process.env.PORT ?? 3000;

  await app.listen(port);

  logger.log(`AgentQueue listening on port ${port}`);
  logger.log(`Worker concurrency: ${engineConfig.workerConcurrency}`);
  logger.log(`Registered triggers: ${engineConfig.getTriggers().length}`);
  logger.log(`Bull Board dashboard: http://localhost:${port}/admin/queues`);
}
void bootstrap();
