import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type MeetingRouteTarget,
  parseMeetingRoute,
} from '../core/meeting-navigation';
import { createMeetingNavigation } from './meeting-navigation';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function setup(initial: MeetingRouteTarget) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [target, setTarget] = createSignal(initial);
    const replace = vi.fn((next: MeetingRouteTarget) => {
      setTarget(next);
    });
    const returnToApp = vi.fn();
    const navigation = createMeetingNavigation({
      target,
      replace,
      returnToApp,
    });
    return { ...navigation, target, setTarget, replace, returnToApp };
  });
}

describe('meeting route ownership', () => {
  it('keeps the draft owner mounted through connection and unexpected disconnect', () => {
    const navigation = setup({ kind: 'new' });
    const owner = navigation.entry();
    navigation.setCallState(owner, false, '');
    expect(navigation.replace).not.toHaveBeenCalled();
    navigation.setCallState(owner, true, 'private-token');
    expect(navigation.target()).toEqual({
      kind: 'active',
      shareToken: 'private-token',
    });
    expect(navigation.entry()).toBe(owner);
    navigation.setCallState(owner, false, 'private-token');
    expect(navigation.target()).toEqual({
      kind: 'setup',
      shareToken: 'private-token',
    });
    expect(navigation.entry()).toBe(owner);
  });

  it('returns to Macro on explicit leave and ignores cleanup before the route unmounts', () => {
    const navigation = setup({ kind: 'new' });
    const owner = navigation.entry();
    navigation.setCallState(owner, true, 'private-token');
    navigation.replace.mockClear();

    navigation.leave(owner);
    navigation.setCallState(owner, false, 'private-token');
    navigation.leave(owner);

    expect(navigation.returnToApp).toHaveBeenCalledOnce();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('puts a freshly opened active URL into setup without starting a connection', () => {
    const navigation = setup({ kind: 'active', shareToken: 'link-token' });
    const owner = navigation.entry();
    navigation.setCallState(owner, false, 'link-token');
    expect(navigation.target()).toEqual({
      kind: 'setup',
      shareToken: 'link-token',
    });
    expect(navigation.entry()).toBe(owner);
  });

  it('restores the active URL if a same-meeting setup link opens while connected', () => {
    const navigation = setup({ kind: 'setup', shareToken: 'link-token' });
    const owner = navigation.entry();
    navigation.setCallState(owner, true, 'link-token');
    navigation.setTarget({ kind: 'setup', shareToken: 'link-token' });
    expect(navigation.target()).toEqual({
      kind: 'active',
      shareToken: 'link-token',
    });
    expect(navigation.entry()).toBe(owner);
  });

  it('replaces the owner for another meeting and ignores stale session callbacks', () => {
    const navigation = setup({ kind: 'setup', shareToken: 'first' });
    const oldOwner = navigation.entry();
    navigation.setCallState(oldOwner, true, 'first');
    navigation.setTarget({ kind: 'setup', shareToken: 'second' });
    expect(navigation.entry()).not.toBe(oldOwner);
    navigation.setCallState(oldOwner, false, 'first');
    navigation.leave(oldOwner);
    expect(navigation.returnToApp).not.toHaveBeenCalled();
    expect(navigation.target()).toEqual({
      kind: 'setup',
      shareToken: 'second',
    });
  });

  it('opens a fresh draft when navigating back to New Call from an owned call', () => {
    const navigation = setup({ kind: 'new' });
    const oldOwner = navigation.entry();
    navigation.setCallState(oldOwner, true, 'created-token');
    navigation.setTarget({ kind: 'new' });
    expect(navigation.entry()).not.toBe(oldOwner);
    expect(navigation.entry()).toEqual({ kind: 'new' });
    navigation.setTarget({ kind: 'setup', shareToken: 'created-token' });
    expect(navigation.entry()).toEqual({
      kind: 'existing',
      shareToken: 'created-token',
    });
  });
});

describe('meeting route parsing', () => {
  it.each([
    ['/meet/new', { kind: 'new' }],
    ['/app/meet/new', { kind: 'new' }],
    ['/app/meet/join/link-token', { kind: 'setup', shareToken: 'link-token' }],
    ['/meet/link-token/', { kind: 'active', shareToken: 'link-token' }],
    ['/meet/join', { kind: 'unavailable' }],
    ['/meet/join/%2Fbad', { kind: 'unavailable' }],
    ['/meet/%ZZ', { kind: 'unavailable' }],
  ])('parses %s', (path, expected) => {
    expect(parseMeetingRoute(path)).toEqual(expected);
  });
});
