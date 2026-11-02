import { ZoneContextManager } from '@macro-inc/observability/zone';
import { context, propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { transferEmailDraft } from '@queries/email/draft';
import { afterEach, expect, it, vi } from 'vitest';
import type { EmailInbox } from '../context/compose-capabilities';
import { createDraftSession } from './draft-session';
import { createDraftTransfer } from './draft-transfer';

const finished: ReadableSpan[] = [];
let open = 0;
let settled: (() => void) | undefined;
context.setGlobalContextManager(new ZoneContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
trace.setGlobalTracerProvider(
  new BasicTracerProvider({
    spanProcessors: [
      {
        onStart: () => {
          open += 1;
        },
        onEnd: (span) => {
          finished.push(span);
          open -= 1;
          if (open === 0) settled?.();
        },
        forceFlush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      },
    ],
  })
);

function spansSettled() {
  return open === 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        settled = resolve;
      });
}

const outlook: EmailInbox = {
  id: 'outlook-inbox',
  email_address: 'me@outlook.example',
  provider: 'OUTLOOK',
  settings: {},
};
const movedDraft = {
  message_id: 'draft-2',
  thread_id: 'thread-2',
  source_id: 'draft-1',
  source_thread_id: 'thread-1',
  attachments: [],
};

const fetch = vi.fn<typeof window.fetch>();

afterEach(() => {
  vi.unstubAllGlobals();
});

function traceparentOf(pathSuffix: string) {
  const call = fetch.mock.calls.find(([input]) =>
    String(input).endsWith(pathSuffix)
  );
  const [, traceId, spanId] =
    new Headers(call?.[1]?.headers).get('traceparent')?.split('-') ?? [];
  return { traceId, spanId };
}

it('keeps the recover request and the detached cache refresh in the move’s trace', async () => {
  vi.stubGlobal('fetch', fetch);
  fetch
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(Response.json({ committed: movedDraft }));
  const transfer = createDraftTransfer({
    session: createDraftSession({
      draftId: 'draft-1',
      threadId: 'thread-1',
      inboxId: 'gmail-inbox',
      persistence: 'committed',
    }),
    persistence: { restored: vi.fn() },
    drafts: {
      async transferDraft(input) {
        const result = await transferEmailDraft(input);
        return {
          draftId: result.message_id,
          threadId: result.thread_id,
          attachments: result.attachments,
        };
      },
    },
    attachments: { list: () => [], replace: vi.fn() },
    save: vi.fn(async () => {}),
    invalidateOldSaves: vi.fn(),
  });

  await expect(transfer.move(outlook, 'gmail-inbox')).resolves.toEqual({
    draftId: 'draft-2',
    threadId: 'thread-2',
  });
  await spansSettled();

  const sent = traceparentOf('/drafts/draft-1/transfer');
  expect(sent.traceId).toMatch(/^[\da-f]{32}$/);
  expect(traceparentOf('/recover').traceId).toBe(sent.traceId);

  const byId = new Map(
    finished.map((span) => [span.spanContext().spanId, span])
  );
  const rootOf = (span: ReadableSpan | undefined): ReadableSpan | undefined =>
    span?.parentSpanContext
      ? rootOf(byId.get(span.parentSpanContext.spanId))
      : span;
  const rootIdOf = (span: ReadableSpan | undefined) =>
    rootOf(span)?.spanContext().spanId;
  expect(new Set(finished.map(rootIdOf))).toEqual(
    new Set([rootIdOf(byId.get(sent.spanId ?? ''))])
  );
});
