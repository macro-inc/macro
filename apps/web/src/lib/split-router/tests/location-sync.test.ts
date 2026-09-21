import { describe, expect, it, vi } from 'vitest';
import { createLocationSync } from '../location-sync';
import { createRoutesManifest, decodeRoute } from '../routes';
import type { SplitRouterExternalLocationValue } from '../types';
import { parseExternalLocation } from '../url';

const routes = createRoutesManifest({
  definitions: [{ id: 'item', path: 'item/:id' }],
});

function setup() {
  let current = parseExternalLocation('/item/initial');
  const commit = vi.fn();
  const sync = createLocationSync({
    routes,
    location: {
      read: () => current,
      commit,
      subscribe: () => () => {},
    },
  });
  const acknowledge = (next: SplitRouterExternalLocationValue) => {
    current = next;
    return sync.acknowledge(next);
  };
  const navigate = (id: string) =>
    sync.commit([decodeRoute(routes, ['item', id])!], {
      history: 'push',
      preserveHash: false,
    });
  return { sync, commit, acknowledge, navigate };
}

describe('external location synchronization', () => {
  it('does not recommit the current location or an outstanding request', () => {
    const { commit, navigate, acknowledge } = setup();
    navigate('initial');
    expect(commit).not.toHaveBeenCalled();
    navigate('next');
    navigate('next');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(acknowledge(parseExternalLocation('/item/next/'))).toBe(true);
    expect(acknowledge(parseExternalLocation('/item/external'))).toBe(false);
  });

  it('repairs stale acknowledgments without pushing another history entry', () => {
    const { commit, navigate, acknowledge } = setup();
    navigate('first');
    navigate('second');
    expect(commit).toHaveBeenCalledTimes(2);
    expect(acknowledge(parseExternalLocation('/item/second'))).toBe(true);
    expect(acknowledge(parseExternalLocation('/item/first'))).toBe(true);
    expect(commit).toHaveBeenCalledTimes(3);
    expect(commit).toHaveBeenLastCalledWith(
      parseExternalLocation('/item/second'),
      { history: 'replace' }
    );
    expect(acknowledge(parseExternalLocation('/item/second'))).toBe(true);
    expect(commit).toHaveBeenCalledTimes(3);
  });
});
