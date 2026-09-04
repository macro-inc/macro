import { describe, expect, it } from 'vitest';
import {
  CONNECTIONS_DISCOVER_SLUG,
  connectionsProviderFromRest,
  connectionsRestForProvider,
  connectionsRestFromPath,
  connectionsRestIsDiscoverReturn,
  isConnectionsRestToken,
  settingsSplitSegmentCount,
} from './settingsConnectionsUrl';

describe('isConnectionsRestToken', () => {
  it('accepts discover, provider slugs, and discover-return tokens', () => {
    expect(isConnectionsRestToken(CONNECTIONS_DISCOVER_SLUG)).toBe(true);
    expect(isConnectionsRestToken('github')).toBe(true);
    expect(isConnectionsRestToken('discover-google')).toBe(true);
    expect(isConnectionsRestToken('email')).toBe(false);
    expect(isConnectionsRestToken('component')).toBe(false);
    expect(isConnectionsRestToken('discover-email')).toBe(false);
  });
});

describe('settingsSplitSegmentCount', () => {
  it('counts a Connections rest token as a third segment', () => {
    expect(settingsSplitSegmentCount('connections', 'discover')).toBe(3);
    expect(settingsSplitSegmentCount('connections', 'github')).toBe(3);
    expect(settingsSplitSegmentCount('connections')).toBe(2);
    expect(settingsSplitSegmentCount('connections', 'nope')).toBe(2);
    expect(settingsSplitSegmentCount('account', 'discover')).toBe(2);
  });
});

describe('connectionsRestFromPath', () => {
  it('reads a rest token after settings/connections', () => {
    expect(connectionsRestFromPath('/settings/connections/discover')).toBe(
      'discover'
    );
    expect(
      connectionsRestFromPath('/component/inbox/settings/connections/github')
    ).toBe('github');
  });

  it('returns null without a rest token or on another tab', () => {
    expect(connectionsRestFromPath('/settings/connections')).toBe(null);
    expect(connectionsRestFromPath('/settings/account')).toBe(null);
    expect(connectionsRestFromPath('/settings/connections/nope')).toBe(null);
  });

  it('reads a discover-return provider token', () => {
    expect(
      connectionsRestFromPath('/settings/connections/discover-google')
    ).toBe('discover-google');
    expect(connectionsProviderFromRest('discover-google')).toBe('google');
    expect(connectionsRestIsDiscoverReturn('discover-google')).toBe(true);
    expect(connectionsRestForProvider('google', true)).toBe('discover-google');
    expect(connectionsRestForProvider('google', false)).toBe('google');
  });
});
