import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';
import { soupItemMatchesHomeTab } from './home-item-filter';

function emailItem(overrides: { isSignal?: boolean } = {}): SoupApiItem {
  return {
    tag: 'emailThread',
    data: { id: 'thread-1', isSignal: overrides.isSignal },
  } as unknown as SoupApiItem;
}

const taskItem = {
  tag: 'document',
  data: { id: 'task-1', subType: { type: 'task' } },
} as unknown as SoupApiItem;

const reminderItem = {
  tag: 'reminder',
  data: { id: 'reminder-1' },
} as unknown as SoupApiItem;

// The macro-3272 shape: a noise email (server is_signal = false) restored
// into the cache by a websocket notification must not enter the Signal feed.
const noiseEmail = emailItem({ isSignal: false });
const signalEmail = emailItem({ isSignal: true });

describe('signal tab', () => {
  it('rejects noise emails', () => {
    expect(soupItemMatchesHomeTab(noiseEmail, 'signal')).toBe(false);
  });

  it('accepts signal emails', () => {
    expect(soupItemMatchesHomeTab(signalEmail, 'signal')).toBe(true);
  });

  it('rejects emails cached before the isSignal field shipped', () => {
    expect(soupItemMatchesHomeTab(emailItem(), 'signal')).toBe(false);
  });

  it('accepts non-email items', () => {
    expect(soupItemMatchesHomeTab(taskItem, 'signal')).toBe(true);
  });
});

describe('noise tab', () => {
  it('accepts noise emails', () => {
    expect(soupItemMatchesHomeTab(noiseEmail, 'noise')).toBe(true);
  });

  it('rejects signal emails', () => {
    expect(soupItemMatchesHomeTab(signalEmail, 'noise')).toBe(false);
  });

  it('rejects emails cached before the isSignal field shipped', () => {
    expect(soupItemMatchesHomeTab(emailItem(), 'noise')).toBe(false);
  });

  it('rejects non-email items', () => {
    expect(soupItemMatchesHomeTab(taskItem, 'noise')).toBe(false);
  });
});

describe('reminders tab', () => {
  it('accepts only reminders', () => {
    expect(soupItemMatchesHomeTab(reminderItem, 'reminders')).toBe(true);
    expect(soupItemMatchesHomeTab(taskItem, 'reminders')).toBe(false);
    expect(soupItemMatchesHomeTab(noiseEmail, 'reminders')).toBe(false);
  });
});
