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
    result[key] = truncate(value) ?? value;
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
        tool: (rawJson['tool'] as string | undefined) ?? undefined,
        toolArgs: truncateArgs(rawJson['args'] ?? rawJson['input']),
      };

    case 'tool_execution_end':
      return {
        type: 'tool_end',
        timestamp,
        tool: (rawJson['tool'] as string | undefined) ?? undefined,
        isError: (rawJson['is_error'] as boolean | undefined) ?? false,
        output: truncate(rawJson['output']),
      };

    case 'turn_start':
      return {
        type: 'turn_start',
        timestamp,
        turnIndex: (rawJson['turn_index'] as number | undefined) ?? undefined,
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
          text: (rawJson['text'] as string | undefined) ?? undefined,
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
