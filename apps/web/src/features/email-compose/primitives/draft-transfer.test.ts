import { Telemetry } from '@macro-inc/observability';
import { StackContextManager } from '@macro-inc/observability/web';
import { context, propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { transferEmailDraft } from '@queries/email/draft';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import {
  DraftTransferAborted,
  type EmailInbox,
} from '../context/compose-capabilities';
import { createDraftSession } from './draft-session';
import { createDraftTransfer } from './draft-transfer';

const finished: ReadableSpan[] = [];
let open = 0;
let settled: (() => void) | undefined;
context.setGlobalContextManager(new StackContextManager().enable());
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

beforeAll(async () => {
  await Telemetry.init({
    serviceName: 'test',
    environment: 'test',
    enabled: async () => true,
  });
});

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

const REFUSED = 'Wait for the draft’s current operation';

/** Answers each request from the next response queued for its path. */
function routeFetch(routes: Record<string, (() => Response)[]>) {
  fetch.mockReset();
  fetch.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    const suffix = Object.keys(routes).find((key) => path.endsWith(key));
    const next = suffix ? routes[suffix].shift() : undefined;
    if (!next) throw new Error(`unexpected request ${path}`);
    return next();
  });
  vi.stubGlobal('fetch', fetch);
}

function requestsTo(pathSuffix: string) {
  return fetch.mock.calls.filter(([input]) =>
    new URL(String(input)).pathname.endsWith(pathSuffix)
  );
}

function traceIdsOf(pathSuffix: string) {
  return requestsTo(pathSuffix).map(
    ([, init]) => new Headers(init?.headers).get('traceparent')?.split('-')[1]
  );
}

const refused = () => Response.json({ message: REFUSED }, { status: 409 });
const operation = (state: string | null) => () =>
  Response.json({
    operation: state ? { state, revision: '2', remote_version: null } : null,
  });

function outlookDraftTransfer() {
  return createDraftTransfer({
    session: createDraftSession({
      draftId: 'draft-1',
      threadId: 'thread-1',
      inboxId: 'outlook-source',
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
}

it('moves the draft once Outlook holds the save the move was refused for', async () => {
  routeFetch({
    '/drafts/draft-1/transfer': [refused, () => Response.json(movedDraft)],
    '/drafts/draft-1/operation': [
      operation('PENDING'),
      operation('SYNCHRONIZED'),
    ],
  });

  await expect(
    outlookDraftTransfer().move(outlook, 'outlook-source')
  ).resolves.toEqual({ draftId: 'draft-2', threadId: 'thread-2' });

  const transfers = requestsTo('/drafts/draft-1/transfer');
  expect(transfers).toHaveLength(2);
  const operationIds = transfers.map(
    ([, init]) => JSON.parse(String(init?.body)).operation_id
  );
  expect(operationIds[1]).toBe(operationIds[0]);
  expect(requestsTo('/recover')).toHaveLength(0);
  // Every request after a wait stays in the move's trace.
  const [traceId] = traceIdsOf('/drafts/draft-1/transfer');
  expect(traceId).toMatch(/^[\da-f]{32}$/);
  expect(
    new Set([
      ...traceIdsOf('/drafts/draft-1/transfer'),
      ...traceIdsOf('/drafts/draft-1/operation'),
    ])
  ).toEqual(new Set([traceId]));
});

it('still aborts a refused move of a draft that has no provider write', async () => {
  routeFetch({
    '/drafts/draft-1/transfer': [refused],
    '/drafts/draft-1/operation': [operation(null)],
    '/recover': [() => Response.json({ committed: null })],
  });

  await expect(
    outlookDraftTransfer().move(outlook, 'outlook-source')
  ).rejects.toBeInstanceOf(DraftTransferAborted);
  expect(requestsTo('/drafts/draft-1/transfer')).toHaveLength(1);
});

it('asks once more, then aborts, when a refused draft is already synchronized', async () => {
  routeFetch({
    '/drafts/draft-1/transfer': [refused, refused],
    '/drafts/draft-1/operation': [
      operation('SYNCHRONIZED'),
      operation('SYNCHRONIZED'),
    ],
    '/recover': [() => Response.json({ committed: null })],
  });

  await expect(
    outlookDraftTransfer().move(outlook, 'outlook-source')
  ).rejects.toBeInstanceOf(DraftTransferAborted);
  expect(requestsTo('/drafts/draft-1/transfer')).toHaveLength(2);
  expect(requestsTo('/recover')).toHaveLength(1);
});

it('aborts a refused move whose draft is in conflict without asking again', async () => {
  routeFetch({
    '/drafts/draft-1/transfer': [refused],
    '/drafts/draft-1/operation': [operation('CONFLICT')],
    '/recover': [() => Response.json({ committed: null })],
  });

  await expect(
    outlookDraftTransfer().move(outlook, 'outlook-source')
  ).rejects.toBeInstanceOf(DraftTransferAborted);
  expect(requestsTo('/drafts/draft-1/transfer')).toHaveLength(1);
});

it('aborts a refused move when the write is still running after the wait', async () => {
  vi.useFakeTimers();
  try {
    routeFetch({
      '/drafts/draft-1/transfer': [refused],
      '/drafts/draft-1/operation': Array.from({ length: 40 }, () =>
        operation('PENDING')
      ),
      '/recover': [() => Response.json({ committed: null })],
    });

    const moving = outlookDraftTransfer().move(outlook, 'outlook-source');
    const aborted = expect(moving).rejects.toBeInstanceOf(DraftTransferAborted);
    await vi.advanceTimersByTimeAsync(31_000);
    await aborted;
    expect(requestsTo('/drafts/draft-1/transfer')).toHaveLength(1);
    expect(requestsTo('/drafts/draft-1/operation').length).toBeGreaterThan(20);
  } finally {
    vi.useRealTimers();
  }
});
