import { describe, expect, it } from 'vitest';
import { normalizeInboxSelection } from './inbox-selection';

describe('inbox selection migration', () => {
  it('chooses the first saved inbox without changing the input', () => {
    const saved = ['inbox-b', 'inbox-a'];
    expect(normalizeInboxSelection(saved)).toEqual(['inbox-b']);
    expect(saved).toEqual(['inbox-b', 'inbox-a']);
  });

  it('preserves a single selected inbox', () => {
    expect(normalizeInboxSelection(['inbox-a'])).toEqual(['inbox-a']);
  });

  it('restores All inboxes for empty or cleared selections', () => {
    expect(normalizeInboxSelection([])).toBeUndefined();
    expect(normalizeInboxSelection(undefined)).toBeUndefined();
  });
});
