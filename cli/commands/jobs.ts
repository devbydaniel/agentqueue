import { Command } from 'commander';
import { listJobs } from '../lib/api.js';
import { relativeTime, truncate, colorStatus } from '../lib/format.js';

export const jobsCommand = new Command('jobs')
  .description('List recent jobs')
  .option('--active', 'Show only active jobs')
  .option('--failed', 'Show only failed jobs')
  .option('--completed', 'Show only completed jobs')
  .option('-n, --limit <number>', 'Number of jobs to show', '20')
  .action(
    async (opts: {
      active?: boolean;
      failed?: boolean;
      completed?: boolean;
      limit: string;
    }) => {
      let status: string | undefined;
      if (opts.active) status = 'active';
      else if (opts.failed) status = 'failed';
      else if (opts.completed) status = 'completed';

      const limit = parseInt(opts.limit, 10) || 20;
      const jobs = await listJobs({ status, limit });

      if (jobs.length === 0) {
        console.log('No jobs found.');
        return;
      }

      // Calculate column widths
      const termWidth = process.stdout.columns || 100;
      const idWidth = 10;
      const targetWidth = 16;
      const statusWidth = 12;
      const ageWidth = 10;
      const padding = 4 * 2; // spaces between columns
      const promptWidth = Math.max(
        10,
        termWidth - idWidth - targetWidth - statusWidth - ageWidth - padding,
      );

      // Header
      const header = [
        'ID'.padEnd(idWidth),
        'TARGET'.padEnd(targetWidth),
        'STATUS'.padEnd(statusWidth),
        'PROMPT'.padEnd(promptWidth),
        'AGE'.padEnd(ageWidth),
      ].join('  ');
      console.log(header);

      // Rows
      for (const job of jobs) {
        const row = [
          truncate(job.id, idWidth).padEnd(idWidth),
          truncate(job.target, targetWidth).padEnd(targetWidth),
          colorStatus(job.status).padEnd(
            statusWidth + (colorStatus(job.status).length - job.status.length),
          ),
          truncate(job.prompt.replace(/\n/g, ' '), promptWidth).padEnd(
            promptWidth,
          ),
          relativeTime(job.createdAt).padEnd(ageWidth),
        ].join('  ');
        console.log(row);
      }
    },
  );
