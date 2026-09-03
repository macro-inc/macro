import { describe, expect, it } from 'vitest';
import {
  CONNECTIONS_DISCOVER_SLUG,
  connectionsRestFromPath,
  isConnectionsRestToken,
} from './settingsConnectionsUrl';

describe('isConnectionsRestToken', () => {
  it('accepts discover and provider slugs', () => {
    expect(isConnectionsRestToken(CONNECTIONS_DISCOVER_SLUG)).toBe(true);
    expect(isConnectionsRestToken('github')).toBe(true);
    expect(isConnectionsRestToken('email')).toBe(false);
    expect(isConnectionsRestToken('component')).toBe(false);
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
});
