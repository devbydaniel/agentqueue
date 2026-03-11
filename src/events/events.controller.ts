import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Req,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import { EventStoreService } from './event-store.service.js';
import type { AgentEvent } from './agent-event.interface.js';
import { JOB_ID_PATTERN } from './validation.js';

function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === 'agent_end' || event.type === 'error';
}

function validateJobIdParam(id: string): void {
  if (!JOB_ID_PATTERN.test(id)) {
    throw new BadRequestException(`Invalid jobId: ${id}`);
  }
}

@Controller('jobs/:id/events')
export class EventsController {
  constructor(private readonly eventStore: EventStoreService) {}

  @Get()
  async getEvents(@Param('id') id: string): Promise<AgentEvent[]> {
    validateJobIdParam(id);
    const { events } = await this.eventStore.getAll(id);
    return events;
  }

  @Sse('stream')
  streamEvents(
    @Param('id') id: string,
    @Req() req: Request,
  ): Observable<MessageEvent> {
    validateJobIdParam(id);
    const abortController = new AbortController();

    req.on('close', () => {
      abortController.abort();
    });

    return new Observable<MessageEvent>((subscriber) => {
      void (async () => {
        try {
          // Get all existing events and the last stream entry ID
          const { events, lastId } = await this.eventStore.getAll(id);

          // Emit existing events
          for (const event of events) {
            subscriber.next({ data: event, type: event.type });
            if (isTerminalEvent(event)) {
              subscriber.complete();
              return;
            }
          }

          // Stream live events starting from lastId (or '0-0' if no entries yet)
          const cursor = lastId ?? '0-0';
          const live = this.eventStore.stream(
            id,
            cursor,
            abortController.signal,
          );
          for await (const event of live) {
            subscriber.next({ data: event, type: event.type });
            if (isTerminalEvent(event)) {
              subscriber.complete();
              return;
            }
          }

          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();

      return () => {
        abortController.abort();
      };
    });
  }
}
