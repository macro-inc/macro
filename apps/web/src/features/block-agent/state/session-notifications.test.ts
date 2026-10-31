import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { FoldStream } from '@core/agent-fold/wasm-module';
import type {
  FoldedMessage,
  SessionMetadata,
  SessionNotification,
} from '@service-agent-fold/generated/types';
import { beforeAll, expect, it } from 'vitest';
import { timelineNotifications } from './session-notifications';

let wasm: {
  FoldStream: new (sessionId: string) => FoldStream;
  initSync: (input: { module: Uint8Array }) => unknown;
};

beforeAll(async () => {
  // Type checking also runs in jobs that do not build the ignored WASM package.
  const url = pathToFileURL(
    `${process.cwd()}/src/lib/core/agent-fold/wasm/agent_fold.js`
  ).href;
  wasm = await import(/* @vite-ignore */ url);
  wasm.initSync({
    module: readFileSync(
      `${process.cwd()}/src/lib/core/agent-fold/wasm/agent_fold_bg.wasm`
    ),
  });
});

it('folds notification frames into timeline metadata without manufacturing user messages', () => {
  const stream = new wasm.FoldStream('019a0000-0000-7000-8000-000000000001');
  try {
    stream.push([
      {
        kind: 'snapshot',
        rows: [
          {
            id: '019a0000-0000-7000-8000-000000000002',
            createdAt: '2026-10-21T00:00:00Z',
            direction: 'notification',
            content: {
              type: 'acp',
              jsonrpc: '2.0',
              id: '019a0000-0000-7000-8000-000000000003',
              method: 'session/prompt',
              params: {
                sessionId: 's',
                prompt: [
                  {
                    type: 'text',
                    text: '<m-notifications>trusted facts</m-notifications>',
                  },
                ],
                _meta: {
                  'macro.dev/notifications': {
                    systemTurn: true,
                    notifications: [
                      {
                        id: '019a0000-0000-7000-8000-000000000004',
                        subjectId: 'connection',
                        createdAt: '2026-10-21T00:00:00Z',
                        kind: 'app.connected',
                        payload: { app: 'Calendar' },
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      },
    ]);
    const messages: FoldedMessage[] = stream.messages();
    const metadata: SessionMetadata = stream.metadata();
    expect(messages).toEqual([]);
    expect(
      timelineNotifications(messages, metadata.notifications)
    ).toHaveLength(1);
    stream.push([
      {
        kind: 'confirmed',
        row: {
          id: '019a0000-0000-7000-8000-000000000005',
          createdAt: '2026-10-21T00:00:01Z',
          direction: 'to_server',
          content: {
            type: 'acp',
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 's',
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: '<noop/>' },
              },
            },
          },
        },
      },
      {
        kind: 'confirmed',
        row: {
          id: '019a0000-0000-7000-8000-000000000006',
          createdAt: '2026-10-21T00:00:02Z',
          direction: 'to_server',
          content: {
            type: 'acp',
            jsonrpc: '2.0',
            id: '019a0000-0000-7000-8000-000000000003',
            result: { stopReason: 'end_turn' },
          },
        },
      },
    ]);
    expect(stream.messages()).toEqual([]);
    const closed: SessionMetadata = stream.metadata();
    expect(closed.noopTurn).toBe(0);
  } finally {
    stream.free();
  }
});

it('suppresses review events only when their trusted card is in the thread', () => {
  const reviewId = '019a0000-0000-7000-8000-000000000005';
  const events: SessionNotification[] = [
    {
      id: 'decided',
      subjectId: reviewId,
      kind: 'review.decided',
      createdAt: '2026-10-22T12:00:00Z',
      turn: 1,
      actionId: 'a',
      systemTurn: true,
      payload: { outcome: 'approved', by: 'owner', via: 'card', items: [] },
    },
    {
      id: 'settled',
      subjectId: reviewId,
      kind: 'review.settled',
      createdAt: '2026-10-22T12:00:00Z',
      turn: 2,
      actionId: 'b',
      systemTurn: true,
      payload: { outcome: 'approved', by: 'owner', via: 'card', items: [] },
    },
    {
      id: 'connected',
      subjectId: 'notion',
      kind: 'app.connected',
      createdAt: '2026-10-22T12:00:00Z',
      turn: 3,
      actionId: 'c',
      systemTurn: true,
      payload: { app: 'Notion' },
    },
  ];
  const card: FoldedMessage = {
    agentSessionId: 'session',
    turn: 0,
    author: { kind: 'agent' },
    requestId: null,
    stop: null,
    segments: [],
    phase: null,
    postedAt: null,
    pending: false,
    parts: [
      {
        kind: 'tool_use',
        id: `review_${reviewId}`,
        name: { kind: 'mcp', server: 'macro_internal', tool: 'PresentReview' },
        status: 'completed',
        detail: {
          kind: 'other',
          acpKind: 'other',
          input: { reviewId },
          output: null,
          result: null,
          error: null,
        },
      },
    ],
  };
  expect(timelineNotifications([], events)).toEqual(events);
  expect(
    timelineNotifications([card], events).map((event) => event.id)
  ).toEqual(['connected']);
  const externalCard: FoldedMessage = {
    ...card,
    parts: card.parts.map((part) =>
      part.kind === 'tool_use'
        ? {
            ...part,
            name: { kind: 'mcp', server: 'external', tool: 'PresentReview' },
          }
        : part
    ),
  };
  expect(timelineNotifications([externalCard], events)).toEqual(events);
});
