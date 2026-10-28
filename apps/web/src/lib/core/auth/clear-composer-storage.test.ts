import { beforeEach, expect, it } from 'vitest';
import {
  COMPOSER_STORAGE_CLEARED,
  clearComposerStorage,
} from './clear-composer-storage';

beforeEach(() => localStorage.clear());

it('clears scoped and legacy drafts and attachments while retaining preferences', () => {
  const keys = [
    'input-value-home-agent-conversation-persist-v0:alice',
    'input-value-agents-new-conversation-persist-v0:bob',
    'input-value-channel-1',
    'task-composer-submission:alice:first',
    'task-composer-submission:alice:first:editing',
    'attachment-tracker-agents-new-conversation-persist-v0:alice',
  ];
  for (const key of keys) localStorage.setItem(key, 'private draft');
  localStorage.setItem('macro-selected-theme', 'dark');
  clearComposerStorage();
  for (const key of keys) expect(localStorage.getItem(key)).toBeNull();
  expect(localStorage.getItem('macro-selected-theme')).toBe('dark');
});

it('retires mounted autosavers before wiping their saved data', () => {
  const key = 'task-composer-submission:alice:first:editing';
  localStorage.setItem(key, 'draft');
  let active = true;
  let valueAtRetire: string | null | undefined;
  const retire = () => {
    valueAtRetire = localStorage.getItem(key);
    active = false;
  };
  window.addEventListener(COMPOSER_STORAGE_CLEARED, retire, { once: true });
  clearComposerStorage();
  expect(valueAtRetire).toBe('draft');
  if (active) localStorage.setItem(key, 'late cleanup');
  expect(localStorage.getItem(key)).toBeNull();
});
