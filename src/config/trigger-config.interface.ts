export interface BaseTrigger {
  name: string;
  type: 'cron' | 'webhook';
  target: string;
  prompt: string;
  agent?: string;
  before?: string;
}

export interface CronTrigger extends BaseTrigger {
  type: 'cron';
  schedule: string;
}

export interface WebhookFilter {
  field: string;
  equals?: string;
  contains?: string;
  in?: string[];
  pattern?: string;
}

export interface WebhookTrigger extends BaseTrigger {
  type: 'webhook';
  source: string;
  events: string[];
  filters?: WebhookFilter[];
}

export type TriggerConfig = CronTrigger | WebhookTrigger;

export interface TriggersFile {
  triggers: TriggerConfig[];
}
