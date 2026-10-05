import { createRoutesManifest } from '@app/lib/split-router/routes';
import {
  decodeSplitRouterLocation,
  serializeSplitRouterLocation,
} from '@app/lib/split-router/url';
import { describe, expect, it, vi } from 'vitest';
import { appSplitRoutes } from '../split-router/app-routes';
import { createMacroMentionLinkResolver } from '../split-router/mention-links';

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const routes = createRoutesManifest(appSplitRoutes);
const viewerState = 's0.changes.pane=split';

function roundTrip(pathname: string, search: string, committed: boolean) {
  const location = { pathname, search: `?${search}`, hash: '' };
  const { entries } = decodeSplitRouterLocation({ routes, location });
  return serializeSplitRouterLocation({
    routes,
    entries,
    previous: location,
    // A layout change commits without the inbound query; only globally owned
    // keys survive it.
    preserveExternalSearch: !committed,
  });
}

describe('application route search ownership', () => {
  it.each([
    '/drive/spreadsheet/sheet-1',
    '/drive/folder/folder-1/spreadsheet/sheet-1',
    '/drive/recent/spreadsheet/sheet-1',
  ])('preserves spreadsheet comment targets on %s', (pathname) => {
    expect(roundTrip(pathname, 'comment_id=message-1', false)).toContain(
      'comment_id=message-1'
    );
  });

  it.each([
    ['/agents/session-1', 'the agents workspace'],
    ['/coders/session-1', 'a coding session'],
    ['/agent/session-1', 'the agent block'],
  ])('keeps the changes pane state on %s (%s)', (pathname) => {
    expect(roundTrip(pathname, viewerState, false)).toContain(viewerState);
    expect(roundTrip(pathname, viewerState, true)).toContain(viewerState);
  });

  it('drops the changes pane state of a split whose route does not own it', () => {
    const result = roundTrip(
      '/agents/session-1/~/reviews',
      's0.changes.pane=split&s1.changes.pane=full',
      true
    );
    expect(result).toContain('s0.changes.pane=split');
    expect(result).not.toContain('s1.changes');
  });

  it('drops search keys no route owns', () => {
    expect(roundTrip('/agents/session-1', 'unowned=1', true)).not.toContain(
      'unowned'
    );
  });
});

const mentionId = '019507e8-14a3-7bc1-8610-419f16bd03a8';
const projectId = '019507e8-14a3-7bc1-8610-419f16bd03a9';
const resolveMention = createMacroMentionLinkResolver(routes);

describe('application route mentions', () => {
  it('preserves spreadsheet comment targets in Drive links', () => {
    expect(
      resolveMention(
        `https://dev.macro.com/app/drive/spreadsheet/${mentionId}?comment_id=message-1`
      )
    ).toEqual({
      id: mentionId,
      block: 'spreadsheet',
      params: { comment_id: 'message-1' },
    });
  });

  it('preserves task comment targets in both task contexts', () => {
    for (const path of [
      `tasks/${mentionId}`,
      `tasks/projects/${projectId}/tasks/task/${mentionId}`,
    ]) {
      expect(
        resolveMention(
          `https://dev.macro.com/app/${path}?comment_id=comment&referral_code=ignored&unknown=drop`
        )
      ).toEqual({
        id: mentionId,
        block: 'task',
        params: { comment_id: 'comment' },
      });
    }
  });

  it('converts Home PR links with foreign entity IDs', () => {
    const id = 'macro-inc/macro/pull/6303';
    expect(
      resolveMention(
        `https://dev.macro.com/app/home/pr/${encodeURIComponent(id)}`
      )
    ).toEqual({ id, block: 'pr', params: {} });
  });

  it('converts agent chats and coding sessions', () => {
    expect(
      resolveMention(`https://dev.macro.com/app/agents/chat/${mentionId}`)
    ).toEqual({ id: mentionId, block: 'chat', params: {} });
    expect(
      resolveMention(`https://dev.macro.com/app/coders/${mentionId}`)
    ).toEqual({ id: mentionId, block: 'agent', params: {} });
  });

  it('resolves canonical routine links and their existing aliases to the same entity', () => {
    for (const path of [
      `routines/${mentionId}`,
      `routine/${mentionId}`,
      `automation/${mentionId}`,
    ]) {
      expect(resolveMention(`https://dev.macro.com/app/${path}`)).toEqual({
        id: mentionId,
        block: 'routine',
        params: {},
      });
    }
  });

  it('uses the rightmost pane of a copied layout URL', () => {
    expect(
      resolveMention(
        `https://dev.macro.com/app/home/~/drive/md/${mentionId}?comment_id=comment`
      )
    ).toEqual({
      id: mentionId,
      block: 'md',
      params: { comment_id: 'comment' },
    });
    expect(
      resolveMention(
        `https://dev.macro.com/app/md/${mentionId}/~/drive/md/${mentionId}`
      )
    ).toEqual({ id: mentionId, block: 'md', params: {} });
    expect(
      resolveMention(
        `https://dev.macro.com/app/not-a-route/~/drive/md/${mentionId}`
      )
    ).toBeUndefined();
    expect(
      resolveMention(
        `https://dev.macro.com/app/drive/md/${mentionId}/~/reviews`
      )
    ).toBeUndefined();
  });

  it('leaves unsupported and invalid destinations as links', () => {
    expect(resolveMention('https://dev.macro.com/app/reviews')).toBeUndefined();
    expect(
      resolveMention('https://dev.macro.com/app/tasks/not-a-uuid')
    ).toBeUndefined();
  });
});
