import { ThrownResultError } from '@core/util/result';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  isForwardRecipientRefusal,
  useForwardCalendarEventMutation,
} from '../forward';

const forwardCalendarEventMock = vi.hoisted(() => vi.fn());

vi.mock('@service-email/client', () => ({
  emailClient: { forwardCalendarEvent: forwardCalendarEventMock },
}));

let testQueryClient: QueryClient;
let dispose: (() => void) | undefined;

function renderHook<T>(factory: () => T): T {
  let hook!: T;
  dispose = render(
    () => (
      <QueryClientProvider client={testQueryClient}>
        {(() => {
          hook = factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  testQueryClient.clear();
});

it('sends the recipients and body for the viewer’s copy', async () => {
  forwardCalendarEventMock.mockResolvedValue(
    ok({ messageId: 'message-1', threadId: 'thread-1' })
  );
  const forward = renderHook(() => useForwardCalendarEventMutation());

  const sent = await forward.mutateAsync({
    eventId: 'event-1',
    recipients: [{ email: 'friend@example.org', name: 'Friend' }],
    bodyText: 'Office tour',
  });

  expect(sent.messageId).toBe('message-1');
  expect(forwardCalendarEventMock).toHaveBeenCalledWith('event-1', {
    to: [{ email: 'friend@example.org', name: 'Friend' }],
    bodyText: 'Office tour',
  });
});

it('reports a refusal of the recipients by its code', async () => {
  forwardCalendarEventMock.mockResolvedValue(
    err([{ code: 'invalid_recipients', message: 'bad address' }])
  );
  const forward = renderHook(() => useForwardCalendarEventMutation());

  const error = await forward
    .mutateAsync({
      eventId: 'event-1',
      recipients: [{ email: 'friend@example.org' }],
      bodyText: 'Office tour',
    })
    .catch((error: unknown) => error);

  expect(error).toBeInstanceOf(ThrownResultError);
  expect(isForwardRecipientRefusal(error)).toBe(true);
});

it('does not treat a failed send as a recipient refusal', async () => {
  forwardCalendarEventMock.mockResolvedValue(
    err([{ code: 'send_failed', message: 'try again' }])
  );
  const forward = renderHook(() => useForwardCalendarEventMutation());

  const error = await forward
    .mutateAsync({
      eventId: 'event-1',
      recipients: [{ email: 'friend@example.org' }],
      bodyText: 'Office tour',
    })
    .catch((error: unknown) => error);

  expect(isForwardRecipientRefusal(error)).toBe(false);
});
