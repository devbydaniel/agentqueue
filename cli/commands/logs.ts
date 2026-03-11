import { Command } from 'commander';
import { getJob, getEvents } from '../lib/api.js';
import { truncate, color } from '../lib/format.js';
import { renderEvents } from './watch.js';

export const logsCommand = new Command('logs')
  .description('Show all events for a job')
  .argument('<job-id>', 'Job ID')
  .action(async (jobId: string) => {
    const job = await getJob(jobId);
    console.log(
      `📋 Job ${color.bold(job.id)} | ${job.target} | "${truncate(job.prompt, 60)}"`,
    );

    const events = await getEvents(jobId);

    if (events.length === 0) {
      console.log(color.gray('No events recorded.'));
      return;
    }

    renderEvents(events);
  });
