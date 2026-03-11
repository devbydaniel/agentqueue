export class JobResponseDto {
  id!: string;
  status!: string;
  target!: string;
  prompt!: string;
  createdAt!: Date;
  finishedAt?: Date;
  result?: unknown;
}
