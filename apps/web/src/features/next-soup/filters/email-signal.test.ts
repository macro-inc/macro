import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';
import { emailItemMatchesImportance } from './email-signal';

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

const noiseEmail = emailItem({ isSignal: false });
const signalEmail = emailItem({ isSignal: true });

describe('emailItemMatchesImportance', () => {
  it('gates importance-filtered signal queries', () => {
    expect(emailItemMatchesImportance(noiseEmail, true)).toBe(false);
    expect(emailItemMatchesImportance(signalEmail, true)).toBe(true);
  });

  it('gates noise queries in the opposite direction', () => {
    expect(emailItemMatchesImportance(noiseEmail, false)).toBe(true);
    expect(emailItemMatchesImportance(signalEmail, false)).toBe(false);
  });

  it('rejects rows cached before the isSignal field shipped from both tabs', () => {
    expect(emailItemMatchesImportance(emailItem(), true)).toBe(false);
    expect(emailItemMatchesImportance(emailItem(), false)).toBe(false);
  });

  it('passes non-email items and queries without an importance filter', () => {
    expect(emailItemMatchesImportance(taskItem, true)).toBe(true);
    expect(emailItemMatchesImportance(taskItem, false)).toBe(true);
    expect(emailItemMatchesImportance(noiseEmail, undefined)).toBe(true);
  });
});
