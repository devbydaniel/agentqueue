import type { AgentEvent } from './agent-event.interface.js';

const MAX_FIELD_LENGTH = 500;

function truncate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return str.length > MAX_FIELD_LENGTH ? str.slice(0, MAX_FIELD_LENGTH) : str;
}

function truncateArgs(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    result[key] = truncate(value);
  }
  return result;
}

export function normalizeEvent(
  rawJson: Record<string, unknown>,
): AgentEvent | null {
  const type = rawJson['type'] as string | undefined;
  if (!type) return null;

  const timestamp = Date.now();

  switch (type) {
    case 'tool_execution_start':
      return {
        type: 'tool_start',
        timestamp,
        tool:
          typeof rawJson['toolName'] === 'string'
            ? rawJson['toolName']
            : typeof rawJson['tool'] === 'string'
              ? rawJson['tool']
              : undefined,
        toolArgs: truncateArgs(rawJson['args'] ?? rawJson['input']),
      };

    case 'tool_execution_end': {
      // Pi emits result as { content: [{ text }] }, flatten to string
      let output: string | undefined;
      const result = rawJson['result'] as Record<string, unknown> | undefined;
      if (result && Array.isArray(result['content'])) {
        const texts = (result['content'] as Array<Record<string, unknown>>)
          .filter((c) => typeof c['text'] === 'string')
          .map((c) => c['text'] as string);
        output = truncate(texts.join('\n'));
      } else {
        output = truncate(rawJson['output']);
      }
      return {
        type: 'tool_end',
        timestamp,
        tool:
          typeof rawJson['toolName'] === 'string'
            ? rawJson['toolName']
            : typeof rawJson['tool'] === 'string'
              ? rawJson['tool']
              : undefined,
        isError: rawJson['isError'] === true || rawJson['is_error'] === true,
        output,
      };
    }

    case 'turn_start':
      return {
        type: 'turn_start',
        timestamp,
        turnIndex:
          typeof rawJson['turn_index'] === 'number'
            ? rawJson['turn_index']
            : undefined,
      };

    case 'turn_end':
      // We don't emit a separate turn_end event
      return null;

    case 'message_update': {
      const subType = rawJson['sub_type'] as string | undefined;
      if (subType === 'text_delta') {
        return {
          type: 'text_delta',
          timestamp,
          text:
            typeof rawJson['text'] === 'string' ? rawJson['text'] : undefined,
        };
      }
      return null;
    }

    case 'agent_end':
      return {
        type: 'agent_end',
        timestamp,
      };

    default:
      return null;
  }
}
