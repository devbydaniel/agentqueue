export interface BaseTrigger {
  name: string;
  type: 'cron' | 'webhook';
  target: string;
  prompt: string;
}

export interface CronTrigger extends BaseTrigger {
  type: 'cron';
  schedule: string;
}

export interface WebhookTrigger extends BaseTrigger {
  type: 'webhook';
  source: string;
  events: string[];
}

export type TriggerConfig = CronTrigger | WebhookTrigger;

export interface TriggersFile {
  triggers: TriggerConfig[];
}
