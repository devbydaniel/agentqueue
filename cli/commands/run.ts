import { Command } from 'commander';
import { enqueueJob } from '../lib/api.js';
import { color } from '../lib/format.js';
import { watchJob } from './watch.js';

export const runCommand = new Command('run')
  .description('Enqueue a new job')
  .argument('<target>', 'Target to run')
  .argument('<prompt>', 'Prompt for the agent')
  .option('-w, --watch', 'Watch the job after enqueuing')
  .option('-a, --agent <agent>', 'Agent to use')
  .option('--priority <number>', 'Job priority', '0')
  .action(
    async (
      target: string,
      prompt: string,
      opts: { watch?: boolean; agent?: string; priority: string },
    ) => {
      const priority = parseInt(opts.priority, 10) || 0;
      const result = await enqueueJob({
        target,
        prompt,
        agent: opts.agent,
        priority: priority ?? undefined,
      });

      console.log(`${color.green('✓')} Job enqueued: ${color.bold(result.id)}`);

      if (opts.watch) {
        await watchJob(result.id);
      }
    },
  );
