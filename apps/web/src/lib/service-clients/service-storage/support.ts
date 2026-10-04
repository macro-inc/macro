import type {
  Detail,
  Inbox,
  LinkedTask,
  NewTicket,
  Reply,
  Settings,
  TaskInput,
  Ticket,
  TicketFilter,
  TicketPatch,
} from '@app/features/support/core/types';
import { throwOnErr } from '@core/util/result';
import { dssFetch } from './client';

const body = (method: string, value: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});
export const supportClient = {
  settings: () => throwOnErr(() => dssFetch<Settings>('/support/settings')),
  configure: (value: Settings) =>
    throwOnErr(() =>
      dssFetch<Settings>('/support/settings', body('PUT', value))
    ),
  inboxes: () => throwOnErr(() => dssFetch<Inbox[]>('/support/inboxes')),
  tickets: (filter: TicketFilter = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter))
      if (value) params.set(key, value);
    return throwOnErr(() => dssFetch<Ticket[]>(`/support/tickets?${params}`));
  },
  detail: (id: string) =>
    throwOnErr(() => dssFetch<Detail>(`/support/tickets/${id}`)),
  create: (value: NewTicket) =>
    throwOnErr(() => dssFetch<Ticket>('/support/tickets', body('POST', value))),
  patch: (id: string, value: TicketPatch) =>
    throwOnErr(() =>
      dssFetch<Ticket>(`/support/tickets/${id}`, body('PATCH', value))
    ),
  reply: (id: string, value: Reply) =>
    throwOnErr(() =>
      dssFetch<Ticket>(`/support/tickets/${id}/messages`, body('POST', value))
    ),
  linkTask: (id: string, value: TaskInput) =>
    throwOnErr(() =>
      dssFetch<LinkedTask>(`/support/tickets/${id}/tasks`, body('POST', value))
    ),
  unlinkTask: (id: string, task: string) =>
    throwOnErr(() =>
      dssFetch(`/support/tickets/${id}/tasks/${encodeURIComponent(task)}`, {
        method: 'DELETE',
      })
    ),
};
