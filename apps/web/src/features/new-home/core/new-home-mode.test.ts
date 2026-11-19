import { describe, expect, it } from 'vitest';
import {
  homeRouteShows,
  newHomeNavActive,
  parseNewHomeTab,
  resolveNewHomeMode,
} from './new-home-mode';

const on = { loading: false, enabled: true };
const off = { loading: false, enabled: false };
const loading = { loading: true, enabled: false };

describe('resolveNewHomeMode', () => {
  it('shows both Homes until old Home is turned off', () => {
    expect(
      resolveNewHomeMode({
        touch: false,
        enableNewHome: on,
        disableOldHome: off,
      })
    ).toBe('both');
    expect(
      resolveNewHomeMode({
        touch: false,
        enableNewHome: on,
        disableOldHome: on,
      })
    ).toBe('new-only');
  });

  it('keeps old Home when only disable-old-home is on', () => {
    expect(
      resolveNewHomeMode({
        touch: false,
        enableNewHome: off,
        disableOldHome: on,
      })
    ).toBe('off');
  });

  it('keeps touch devices on today’s Home whatever the flags say', () => {
    expect(
      resolveNewHomeMode({
        touch: true,
        enableNewHome: on,
        disableOldHome: on,
      })
    ).toBe('off');
  });

  it('waits for the flags that decide the mode', () => {
    expect(
      resolveNewHomeMode({
        touch: false,
        enableNewHome: loading,
        disableOldHome: off,
      })
    ).toBeUndefined();
    expect(
      resolveNewHomeMode({
        touch: false,
        enableNewHome: on,
        disableOldHome: loading,
      })
    ).toBeUndefined();
    expect(
      resolveNewHomeMode({
        touch: false,
        enableNewHome: off,
        disableOldHome: loading,
      })
    ).toBe('off');
  });
});

describe('parseNewHomeTab', () => {
  it('opens Recent unless Notifications was the last tab', () => {
    expect(parseNewHomeTab(null)).toBe('recent');
    expect(parseNewHomeTab('something else')).toBe('recent');
    expect(parseNewHomeTab('notifications')).toBe('notifications');
  });
});

describe('newHomeNavActive', () => {
  it('marks New Home, not old Home, for Recent and Notifications', () => {
    const both = (itemId: string, viewId: string, recentTab = false) =>
      newHomeNavActive({ itemId, mode: 'both', viewId, recentTab });
    expect(both('new-home', 'home', true)).toBe(true);
    expect(both('home', 'home', true)).toBe(false);
    expect(both('new-home', 'notifications')).toBe(true);
    expect(both('home', 'home')).toBe(true);
    expect(both('new-home', 'home')).toBe(false);
  });

  it('makes the Home item New Home once old Home is off', () => {
    expect(
      newHomeNavActive({
        itemId: 'home',
        mode: 'new-only',
        viewId: 'notifications',
        recentTab: false,
      })
    ).toBe(true);
  });

  it('leaves the rail alone while New Home is off', () => {
    expect(
      newHomeNavActive({
        itemId: 'home',
        mode: 'off',
        viewId: 'home',
        recentTab: true,
      })
    ).toBeUndefined();
  });
});

describe('homeRouteShows', () => {
  it('keeps old Home at /home beside New Home, which has the Recent tab', () => {
    expect(homeRouteShows({ mode: 'both', recentTab: false })).toBe('old');
    expect(homeRouteShows({ mode: 'both', recentTab: true })).toBe('new');
    expect(homeRouteShows({ mode: 'off', recentTab: true })).toBe('old');
  });

  it('shows New Home at every /home once old Home is off', () => {
    expect(homeRouteShows({ mode: 'new-only', recentTab: false })).toBe('new');
  });

  it('holds a Recent link until the flags answer', () => {
    expect(homeRouteShows({ mode: undefined, recentTab: true })).toBe(
      'pending'
    );
    expect(homeRouteShows({ mode: undefined, recentTab: false })).toBe('old');
  });
});
