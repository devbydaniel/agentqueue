import { normalizeEvent } from './event-normalizer.js';

describe('normalizeEvent', () => {
  it('should normalize tool_execution_start', () => {
    const result = normalizeEvent({
      type: 'tool_execution_start',
      tool: 'bash',
      args: { command: 'ls' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        type: 'tool_start',
        tool: 'bash',
        toolArgs: { command: 'ls' },
      }),
    );
    expect(result!.timestamp).toBeGreaterThan(0);
  });

  it('should normalize tool_execution_end', () => {
    const result = normalizeEvent({
      type: 'tool_execution_end',
      tool: 'bash',
      is_error: false,
      output: 'file1.ts\nfile2.ts',
    });

    expect(result).toEqual(
      expect.objectContaining({
        type: 'tool_end',
        tool: 'bash',
        isError: false,
        output: 'file1.ts\nfile2.ts',
      }),
    );
  });

  it('should normalize turn_start', () => {
    const result = normalizeEvent({
      type: 'turn_start',
      turn_index: 1,
    });

    expect(result).toEqual(
      expect.objectContaining({
        type: 'turn_start',
        turnIndex: 1,
      }),
    );
  });

  it('should normalize message_update with text_delta', () => {
    const result = normalizeEvent({
      type: 'message_update',
      sub_type: 'text_delta',
      text: 'Hello world',
    });

    expect(result).toEqual(
      expect.objectContaining({
        type: 'text_delta',
        text: 'Hello world',
      }),
    );
  });

  it('should normalize agent_end', () => {
    const result = normalizeEvent({ type: 'agent_end' });

    expect(result).toEqual(
      expect.objectContaining({
        type: 'agent_end',
      }),
    );
  });

  it('should return null for unknown event types', () => {
    expect(normalizeEvent({ type: 'session' })).toBeNull();
    expect(normalizeEvent({ type: 'message_start' })).toBeNull();
    expect(normalizeEvent({ type: 'toolcall_delta' })).toBeNull();
  });

  it('should return null for turn_end', () => {
    expect(normalizeEvent({ type: 'turn_end' })).toBeNull();
  });

  it('should return null for message_update without text_delta sub_type', () => {
    expect(
      normalizeEvent({ type: 'message_update', sub_type: 'other' }),
    ).toBeNull();
  });

  it('should return null when type is missing', () => {
    expect(normalizeEvent({ foo: 'bar' })).toBeNull();
  });

  it('should truncate long tool args to 500 chars', () => {
    const longArg = 'x'.repeat(1000);
    const result = normalizeEvent({
      type: 'tool_execution_start',
      tool: 'bash',
      args: { command: longArg },
    });

    expect(result!.toolArgs!['command']).toHaveLength(500);
  });

  it('should truncate long output to 500 chars', () => {
    const longOutput = 'y'.repeat(1000);
    const result = normalizeEvent({
      type: 'tool_execution_end',
      tool: 'bash',
      is_error: false,
      output: longOutput,
    });

    expect(result!.output).toHaveLength(500);
  });
});
