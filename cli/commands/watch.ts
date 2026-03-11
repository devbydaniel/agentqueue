import { Command } from 'commander';
import { getJob, streamEventsUrl } from '../lib/api.js';
import type { AgentEvent } from '../lib/api.js';
import { truncate, toolIcon, color } from '../lib/format.js';

function renderEvent(event: AgentEvent): string | null {
  switch (event.type) {
    case 'turn_start':
      return `\n🔄 Turn ${(event.turnIndex ?? 0).toString()}`;
    case 'tool_start': {
      const tool = event.tool ?? 'unknown';
      const icon = toolIcon(tool);
      const argsPreview = event.toolArgs
        ? truncate(JSON.stringify(event.toolArgs), 80)
        : '';
      return `   ${icon} ${tool} ${color.gray(argsPreview)}`;
    }
    case 'tool_end': {
      const tool = event.tool ?? 'unknown';
      const icon = toolIcon(tool);
      const marker = event.isError ? color.red('❌') : color.green('✓');
      return `   ${icon} ${tool} ${marker}`;
    }
    case 'text_delta':
      return null; // Accumulate silently
    case 'agent_end':
      return `\n${color.green('✅ Agent completed')}`;
    case 'error':
      return `\n${color.red(`❌ Error: ${event.text ?? 'unknown error'}`)}`;
    case 'log':
      return `   ${color.gray(`⋮ ${event.text ?? ''}`)}`;
    default:
      return null;
  }
}

export function renderEvents(events: AgentEvent[]): void {
  for (const event of events) {
    const line = renderEvent(event);
    if (line !== null) {
      console.log(line);
    }
  }
}

export async function watchJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  console.log(
    `⏳ Job ${color.bold(job.id)} | ${job.target} | "${truncate(job.prompt, 60)}"`,
  );

  const url = streamEventsUrl(jobId);
  const abortController = new AbortController();

  const cleanup = () => {
    abortController.abort();
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: abortController.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `HTTP ${res.status.toString()} ${res.statusText}: ${body}`,
      );
    }

    if (!res.body) {
      throw new Error('No response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data) as AgentEvent;
            const rendered = renderEvent(event);
            if (rendered !== null) {
              console.log(rendered);
            }
            if (event.type === 'agent_end' || event.type === 'error') {
              return;
            }
          } catch {
            // Ignore malformed SSE data
          }
        }
      }
    }
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.includes('abort'))
    ) {
      console.log(`\n${color.gray('Watch stopped.')}`);
      return;
    }
    throw err;
  } finally {
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
  }
}

export const watchCommand = new Command('watch')
  .description('Watch a job in real-time via SSE')
  .argument('<job-id>', 'Job ID')
  .action(async (jobId: string) => {
    await watchJob(jobId);
  });
