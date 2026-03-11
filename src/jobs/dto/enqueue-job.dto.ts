import {
  IsString,
  IsOptional,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TriggerDto {
  @IsString()
  type!: string;

  @IsOptional()
  @IsString()
  source?: string;
}

export class EnqueueJobDto {
  @IsString()
  target!: string;

  @IsString()
  prompt!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TriggerDto)
  trigger?: TriggerDto;

  @IsOptional()
  @IsString()
  agent?: string;

  @IsOptional()
  @IsNumber()
  priority?: number;
}
