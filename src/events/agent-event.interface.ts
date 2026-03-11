export interface AgentEvent {
  type:
    | 'turn_start'
    | 'tool_start'
    | 'tool_end'
    | 'text_delta'
    | 'agent_end'
    | 'log'
    | 'error';
  timestamp: number;
  turnIndex?: number;
  tool?: string;
  toolArgs?: Record<string, unknown>;
  isError?: boolean;
  text?: string;
  output?: string;
}
