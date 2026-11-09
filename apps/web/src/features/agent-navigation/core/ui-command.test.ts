import { describe, expect, it } from 'vitest';
import { appRoutesManifest } from '../tests/app-routes';
import { decideUiCommand, type UiCommandRecipient } from './ui-command';

const ME: UiCommandRecipient = {
  userId: 'macro|owner@example.com',
  clientId: '0198a4cc-e138-7670-a308-a6b7666027c1',
};
const DOC = '0198a4cc-e138-7670-a308-a6b766602799';

function frame(overrides: Record<string, unknown> = {}) {
  return {
    commandId: '0198a4cc-e138-7670-a308-a6b7666027aa',
    userId: ME.userId,
    clientId: ME.clientId,
    sessionId: '0198a4cc-e138-7670-a308-a6b766602700',
    agentName: 'Research agent',
    kind: 'open',
    path: `/md/${DOC}`,
    placement: 'beside-agent',
    ...overrides,
  };
}

const routes = appRoutesManifest();

describe('decideUiCommand', () => {
  it('opens an item named for this tab', () => {
    const legacy = decideUiCommand(routes, ME, frame());
    const canonical = decideUiCommand(
      routes,
      ME,
      frame({ path: `/drive/md/${DOC}` })
    );

    expect(legacy.kind === 'open' && legacy.route).toBe('legacy-content');
    expect(canonical.kind === 'open' && canonical.route).toBe('drive-document');
    if (canonical.kind !== 'open') return;
    expect(canonical.location.route.matches.at(-1)?.params).toMatchObject({
      documentId: DOC,
    });
  });

  it('keeps a channel message target from the query', () => {
    const decision = decideUiCommand(
      routes,
      ME,
      frame({ path: '/channels/c1?s0.channels.messageId=m1' })
    );

    expect(decision.kind).toBe('open');
    if (decision.kind !== 'open') return;
    expect(decision.route).toBe('channels-channel');
    expect(JSON.stringify(decision.location.search)).toContain('m1');
  });

  it('ignores a frame for another tab or another person', () => {
    for (const other of [
      frame({ clientId: '0198a4cc-e138-7670-a308-a6b7666027c2' }),
      frame({ userId: 'macro|someone@example.com' }),
      frame({ clientId: undefined }),
      { ...frame(), kind: 'navigate' },
      'not a frame',
    ]) {
      expect(decideUiCommand(routes, ME, other)).toEqual({ kind: 'ignore' });
    }
  });

  it('refuses a foreign or closed route even when the server let it through', () => {
    for (const path of [
      'https://evil.example.com/app/md/x',
      '//evil.example.com/md/x',
      'javascript:alert(1)',
      '/md/x#token',
      '/mail/new?to=someone%40example.com',
      '/email/new',
      '/companies/pipeline/../../mail/new',
      '/drive/md/%2e%2e/x',
      '/meet/join/token',
      '/settings/api-keys',
      '/component/settings',
      '/debug/ui',
      '/routines/new',
      `/md/${DOC}/~/channels/c1`,
      '/no-such-route/at-all/here',
    ]) {
      expect(decideUiCommand(routes, ME, frame({ path })), path).toEqual({
        kind: 'refuse',
      });
    }
  });
});
