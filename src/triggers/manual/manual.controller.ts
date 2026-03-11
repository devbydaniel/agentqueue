import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service.js';
import { EnqueueJobDto } from '../../jobs/dto/enqueue-job.dto.js';
import { JobResponseDto } from '../../jobs/dto/job-response.dto.js';
import { AgentJobData } from '../../jobs/job.interface.js';

@Controller('jobs')
export class ManualController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async enqueue(@Body() dto: EnqueueJobDto): Promise<{ id: string }> {
    const trigger = dto.trigger ?? { type: 'manual' };

    const data: AgentJobData = {
      target: dto.target,
      prompt: dto.prompt,
      trigger,
      agent: dto.agent,
      priority: dto.priority,
    };

    const id = await this.jobsService.enqueue(data);
    return { id };
  }

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<JobResponseDto[]> {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    return this.jobsService.list({
      status,
      limit: parsed && parsed > 0 ? parsed : undefined,
    });
  }

  @Get(':id')
  async getStatus(@Param('id') id: string): Promise<JobResponseDto> {
    return this.jobsService.getStatus(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(@Param('id') id: string): Promise<void> {
    await this.jobsService.cancel(id);
  }
}
