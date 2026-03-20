#!/usr/bin/env node

import { Command } from 'commander';
import { statusCommand } from './commands/status.js';
import { killCommand } from './commands/kill.js';
import { jobsCommand } from './commands/jobs.js';
import { watchCommand } from './commands/watch.js';
import { logsCommand } from './commands/logs.js';
import { runCommand } from './commands/run.js';
import { triggersCommand } from './commands/triggers.js';

const program = new Command();

program
  .name('aq')
  .description('AgentQueue CLI — manage and monitor agent jobs')
  .version('0.1.0');

program.addCommand(statusCommand);
program.addCommand(killCommand);
program.addCommand(jobsCommand);
program.addCommand(watchCommand);
program.addCommand(logsCommand);
program.addCommand(runCommand);
program.addCommand(triggersCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
