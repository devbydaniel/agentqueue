import { Command } from 'commander';
import { deleteJob } from '../lib/api.js';
import { color } from '../lib/format.js';

export const killCommand = new Command('kill')
  .description('Cancel/remove a job')
  .argument('<job-id>', 'Job ID')
  .action(async (jobId: string) => {
    await deleteJob(jobId);
    console.log(`${color.green('✓')} Job ${jobId} cancelled`);
  });
