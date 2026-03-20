export interface AgentJobData {
  target: string;
  prompt: string;
  trigger: {
    type: string;
    source?: string;
  };
  agent?: string;
  priority?: number;
  before?: string;
}
