import { describe, expect, it } from 'vitest';
import { createMemorySplitRouterLocation } from '../integrations/memory';

describe('memory external location', () => {
  it('restores state for duplicate URLs across Back and Forward', () => {
    const location = createMemorySplitRouterLocation({
      pathname: '/drive',
      search: '',
      hash: '',
      state: { entry: 'first' },
    });

    location.set({
      pathname: '/drive',
      search: '',
      hash: '',
      state: { entry: 'second' },
    });

    expect(location.read().state).toEqual({ entry: 'second' });
    expect(location.back()).toBe(true);
    expect(location.read().state).toEqual({ entry: 'first' });
    expect(location.forward()).toBe(true);
    expect(location.read().state).toEqual({ entry: 'second' });
  });
});
