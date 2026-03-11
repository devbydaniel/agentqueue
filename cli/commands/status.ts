import { Command } from 'commander';
import { getJob } from '../lib/api.js';
import { relativeTime, truncate, color } from '../lib/format.js';

export const statusCommand = new Command('status')
  .description('Show details of a job')
  .argument('<job-id>', 'Job ID')
  .action(async (jobId: string) => {
    const job = await getJob(jobId);

    console.log(`${color.bold('ID:')}        ${job.id}`);
    console.log(`${color.bold('Target:')}    ${job.target}`);
    console.log(`${color.bold('Status:')}    ${job.status}`);
    console.log(`${color.bold('Prompt:')}    ${truncate(job.prompt, 80)}`);
    console.log(
      `${color.bold('Created:')}   ${new Date(job.createdAt).toLocaleString()} (${relativeTime(job.createdAt)})`,
    );
    if (job.finishedAt) {
      console.log(
        `${color.bold('Finished:')}  ${new Date(job.finishedAt).toLocaleString()} (${relativeTime(job.finishedAt)})`,
      );
    }
    if (job.result != null) {
      const preview =
        typeof job.result === 'string'
          ? job.result
          : JSON.stringify(job.result);
      console.log(`${color.bold('Result:')}    ${truncate(preview, 200)}`);
    }
  });
