import { Command } from 'commander';
import { color, truncate } from '../lib/format.js';

interface TriggerStatus {
  name: string;
  type: string;
  target: string;
  schedule?: string;
  schedulerId: string;
  status: 'active' | 'stale';
  nextRun?: string;
}

const BASE_URL = process.env['AQ_URL'] ?? 'http://localhost:3000';

async function fetchTriggers(): Promise<TriggerStatus[]> {
  const res = await fetch(`${BASE_URL}/triggers`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as TriggerStatus[];
}

function formatNextRun(iso?: string): string {
  if (!iso) return color.gray('—');
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();

  // Format as readable time
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayStr = dayNames[d.getDay()];

  if (diffMs < 0) return color.red(`${dayStr} ${timeStr} (overdue)`);
  if (diffMs < 3600000) {
    const mins = Math.floor(diffMs / 60000);
    return color.yellow(`${dayStr} ${timeStr} (in ${mins}m)`);
  }
  return `${dayStr} ${timeStr}`;
}

export const triggersCommand = new Command('triggers')
  .description('List configured and stale trigger schedulers')
  .action(async () => {
    try {
      const triggers = await fetchTriggers();

      if (triggers.length === 0) {
        console.log('No triggers found.');
        return;
      }

      // Table header
      const nameW = 22;
      const schedW = 18;
      const targetW = 14;
      const statusW = 10;
      const nextW = 26;

      console.log(
        color.bold(
          'NAME'.padEnd(nameW) +
            'SCHEDULE'.padEnd(schedW) +
            'TARGET'.padEnd(targetW) +
            'STATUS'.padEnd(statusW) +
            'NEXT RUN',
        ),
      );

      for (const t of triggers) {
        const statusStr =
          t.status === 'stale'
            ? color.red('STALE')
            : color.green('active');

        const name =
          t.status === 'stale'
            ? color.red(truncate(t.name, nameW - 1))
            : truncate(t.name, nameW - 1);

        console.log(
          name.padEnd(nameW + (t.status === 'stale' ? 9 : 0)) +
            (t.schedule ?? color.gray('—')).padEnd(schedW) +
            truncate(t.target, targetW - 1).padEnd(targetW) +
            statusStr.padEnd(statusW + 9) +
            formatNextRun(t.nextRun),
        );
      }
    } catch (err) {
      console.error(
        err instanceof Error ? err.message : String(err),
      );
      process.exit(1);
    }
  });
