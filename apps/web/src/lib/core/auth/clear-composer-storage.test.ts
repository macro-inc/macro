import { beforeEach, expect, it } from 'vitest';
import { clearComposerStorage } from './clear-composer-storage';

beforeEach(() => localStorage.clear());

it('clears scoped and legacy drafts and attachments while retaining preferences', () => {
  const keys = [
    'input-value-home-agent-conversation-persist-v0:alice',
    'input-value-agents-new-conversation-persist-v0:bob',
    'input-value-channel-1',
    'attachment-tracker-agents-new-conversation-persist-v0:alice',
  ];
  for (const key of keys) localStorage.setItem(key, 'private draft');
  localStorage.setItem('macro-selected-theme', 'dark');
  clearComposerStorage();
  for (const key of keys) expect(localStorage.getItem(key)).toBeNull();
  expect(localStorage.getItem('macro-selected-theme')).toBe('dark');
});
