import { describe, expect, it } from 'vitest';
import { normalizeInboxSelection } from './inbox-selection';

describe('inbox selection', () => {
  it('keeps every chosen inbox once, without changing the input', () => {
    const saved = ['inbox-b', 'inbox-a', 'inbox-b'];
    expect(normalizeInboxSelection(saved)).toEqual(['inbox-b', 'inbox-a']);
    expect(saved).toEqual(['inbox-b', 'inbox-a', 'inbox-b']);
  });

  it('restores All inboxes for empty or cleared selections', () => {
    expect(normalizeInboxSelection([])).toBeUndefined();
    expect(normalizeInboxSelection(undefined)).toBeUndefined();
  });
});
