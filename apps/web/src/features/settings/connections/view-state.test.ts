import {
  connectionsRest,
  setConnectionsRest,
} from '@core/signal/connectionsRest';
import { afterEach, describe, expect, it } from 'vitest';
import { openConnectionsProvider } from './view-state';

afterEach(() => {
  setConnectionsRest(null);
});

describe('openConnectionsProvider', () => {
  it('keeps provider Back on Discover while Discover rest is live', () => {
    setConnectionsRest('discover');
    openConnectionsProvider('google');
    expect(connectionsRest()).toBe('discover-google');
  });

  it('opens a later provider without Discover return after rest is cleared', () => {
    setConnectionsRest('discover-google');
    setConnectionsRest(null);
    openConnectionsProvider('github');
    expect(connectionsRest()).toBe('github');
  });
});
