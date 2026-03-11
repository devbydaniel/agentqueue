import type { AgentEvent } from '../../src/events/agent-event.interface.js';

export type { AgentEvent };

const BASE_URL = process.env['AQ_URL'] ?? 'http://localhost:3000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status.toString()} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface JobResponse {
  id: string;
  status: string;
  target: string;
  prompt: string;
  createdAt: string;
  finishedAt?: string;
  result?: unknown;
}

export function getJob(id: string): Promise<JobResponse> {
  return request<JobResponse>(`/jobs/${encodeURIComponent(id)}`);
}

export function deleteJob(id: string): Promise<void> {
  return request<void>(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function listJobs(options?: {
  status?: string;
  limit?: number;
}): Promise<JobResponse[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.limit) params.set('limit', options.limit.toString());
  const qs = params.toString();
  return request<JobResponse[]>(`/jobs${qs ? `?${qs}` : ''}`);
}

export function enqueueJob(data: {
  target: string;
  prompt: string;
  agent?: string;
  priority?: number;
}): Promise<{ id: string }> {
  return request<{ id: string }>('/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function getEvents(id: string): Promise<AgentEvent[]> {
  return request<AgentEvent[]>(`/jobs/${encodeURIComponent(id)}/events`);
}

export function streamEventsUrl(id: string): string {
  return `${BASE_URL}/jobs/${encodeURIComponent(id)}/events/stream`;
}
