import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handler: undefined as
    | ((message: { type: string; data: string }) => void)
    | undefined,
  refresh: vi.fn(async () => undefined),
}));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: (
    handler: (message: { type: string; data: string }) => void
  ) => {
    mocks.handler = handler;
  },
}));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: {},
}));
vi.mock('./client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock('./preview', () => ({
  invalidatePreview: vi.fn(async () => undefined),
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refresh,
}));

const { useChatRenameWebsocketSync } = await import('./chat');

beforeEach(() => {
  mocks.refresh.mockClear();
});

it('reads GraphQL lists the cache does not keep current after a chat rename', () => {
  useChatRenameWebsocketSync();
  const rename = { type: 'chat_renamed', chat_id: 'chat-1', name: 'Plans' };
  mocks.handler?.({ type: 'chat_renamed', data: JSON.stringify(rename) });
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
    unmaintainedOnly: true,
  });
});

it('reads nothing again for other messages', () => {
  useChatRenameWebsocketSync();
  mocks.handler?.({ type: 'chat_created', data: '{}' });
  expect(mocks.refresh).not.toHaveBeenCalled();
});
