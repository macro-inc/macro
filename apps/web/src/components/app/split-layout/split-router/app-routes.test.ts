import {
  readDiffUrlState,
  writeDiffUrlState,
} from '@app/features/agent-changes/core/url-state';
import { createRoutesManifest } from '@app/lib/split-router/routes';
import {
  decodeSplitRouterLocation,
  serializeSplitRouterLocation,
} from '@app/lib/split-router/url';
import { describe, expect, it, vi } from 'vitest';
import { appSplitRoutes } from './app-routes';

// Route matching needs only block name resolution, not every block's UI.
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (type: string) => type,
  isBlockAlias: () => false,
  resolveBlockAlias: (type: string) => type,
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect() {},
  createConnectionWebsocketEffect() {},
  parseWebsocketPayload: () => undefined,
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { send() {}, addEventListener() {}, removeEventListener() {} },
  createWebSocketJob: () => Promise.reject(new Error('no websocket in tests')),
}));

describe('app diff URLs', () => {
  it.each(['/pr/pr-entity', '/agent/session-1/~/pr/pr-entity'])(
    'retains the selected PR tab and diff layout while normalizing %s',
    (pathname) => {
      const routes = createRoutesManifest(appSplitRoutes);
      const sessionState = {
        layout: 'agent-only',
        diffStyle: 'split',
      } as const;
      const prState = { layout: 'changes-only', diffStyle: 'split' } as const;
      const sessionDiff = writeDiffUrlState(
        undefined,
        'session-1',
        sessionState
      );
      const diff = writeDiffUrlState(sessionDiff, 'pr:pr-entity', prState)!;
      const query = new URLSearchParams({
        diff,
        referral_code: 'ref',
        unowned: 'drop',
      });
      const previous = `${pathname}?${query}`;
      const parsed = decodeSplitRouterLocation({ routes, location: previous });
      const normalized = new URL(
        serializeSplitRouterLocation({
          routes,
          entries: parsed.entries,
          previous,
        }),
        'https://macro.test'
      );

      expect(normalized.pathname).toBe(pathname);
      expect(
        readDiffUrlState(normalized.searchParams.get('diff'), 'pr:pr-entity')
      ).toEqual(prState);
      expect(
        readDiffUrlState(normalized.searchParams.get('diff'), 'session-1')
      ).toEqual(sessionState);
      expect(normalized.searchParams.get('referral_code')).toBe('ref');
      expect(normalized.searchParams.has('unowned')).toBe(false);
    }
  );
});
