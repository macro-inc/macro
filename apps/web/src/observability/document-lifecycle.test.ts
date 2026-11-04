import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearDocumentLifecycle,
  recordDocumentNavigation,
  startDocumentLifecycle,
} from './document-lifecycle';
import { frontendInstanceId } from './frontend-instance';

const key = 'macro-document-lifecycle';
const previousId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  sessionStorage.clear();
});

afterEach(() => {
  clearDocumentLifecycle();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('recovers the last checkpoint after a document disappears without pagehide', () => {
  sessionStorage.setItem(
    key,
    JSON.stringify({
      frontendInstanceId: previousId,
      startedAtMs: 80_000,
      updatedAtMs: 90_000,
      visible: true,
    })
  );
  const { attributes } = startDocumentLifecycle();
  expect(attributes).toMatchObject({
    previous_document_checkpoint_available: true,
    previous_document_instance_id: previousId,
    previous_document_visible: true,
    previous_document_pagehide_observed: false,
  });
  expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({
    frontendInstanceId,
  });
});

it('records visibility and orderly pagehide locally without timers or network calls', () => {
  startDocumentLifecycle();
  vi.setSystemTime(101_000);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(
    new PageTransitionEvent('pagehide', { persisted: false })
  );
  expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({
    visible: false,
    updatedAtMs: 101_000,
    pagehide: { atMs: 101_000, persisted: false },
  });
});

it('clears the old pagehide marker when the same document returns from bfcache', () => {
  startDocumentLifecycle();
  window.dispatchEvent(
    new PageTransitionEvent('pagehide', { persisted: true })
  );
  window.dispatchEvent(
    new PageTransitionEvent('pageshow', { persisted: true })
  );
  expect(JSON.parse(sessionStorage.getItem(key)!)).not.toHaveProperty(
    'pagehide'
  );
});

it('does not let an old document overwrite its replacement', () => {
  startDocumentLifecycle();
  const replacement = JSON.stringify({
    frontendInstanceId: previousId,
    startedAtMs: 100_000,
    updatedAtMs: 100_000,
    visible: true,
  });
  sessionStorage.setItem(key, replacement);
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(sessionStorage.getItem(key)).toBe(replacement);
});

it('invalidates another document checkpoint when an older page resumes from bfcache', () => {
  startDocumentLifecycle();
  sessionStorage.setItem(
    key,
    JSON.stringify({
      frontendInstanceId: previousId,
      startedAtMs: 100_000,
      updatedAtMs: 100_000,
      visible: true,
    })
  );
  window.dispatchEvent(
    new PageTransitionEvent('pageshow', { persisted: true })
  );
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(
    startDocumentLifecycle().attributes.previous_document_checkpoint_available
  ).toBe(false);
});

it('logout removes the checkpoint and prevents callbacks from recreating it', () => {
  sessionStorage.setItem(
    key,
    JSON.stringify({
      frontendInstanceId: previousId,
      startedAtMs: 80_000,
      updatedAtMs: 90_000,
      visible: true,
    })
  );
  const lifecycle = startDocumentLifecycle();
  expect(lifecycle.attributes.previous_document_checkpoint_available).toBe(
    true
  );
  clearDocumentLifecycle();
  recordDocumentNavigation({
    paneCount: 1,
    historyEntryCount: 8,
    savedEntryStateCount: 7,
  });
  expect(lifecycle.attributes.previous_document_checkpoint_available).toBe(
    false
  );
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
  window.dispatchEvent(
    new PageTransitionEvent('pageshow', { persisted: true })
  );
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(
    startDocumentLifecycle().attributes.previous_document_checkpoint_available
  ).toBe(false);
});

it('recovers navigation counts without saving route or result content', () => {
  const first = startDocumentLifecycle();
  recordDocumentNavigation({
    paneCount: 2,
    historyEntryCount: 15,
    savedEntryStateCount: 4,
  });
  recordDocumentNavigation({
    paneCount: 1,
    historyEntryCount: 2,
    savedEntryStateCount: 1,
  });
  const saved = JSON.parse(sessionStorage.getItem(key)!);
  expect(saved.navigation).toEqual({
    commits: 2,
    paneCount: 1,
    historyEntryCount: 2,
    savedEntryStateCount: 1,
  });
  first.dispose();
  sessionStorage.setItem(
    key,
    JSON.stringify({ ...saved, frontendInstanceId: previousId })
  );
  expect(startDocumentLifecycle().attributes).toMatchObject({
    previous_document_navigation_commits: 2,
    previous_document_pane_count: 1,
    previous_document_history_entry_count: 2,
    previous_document_saved_entry_state_count: 1,
  });
});

it('an old disposer cannot stop navigation checkpoints for its successor', () => {
  const first = startDocumentLifecycle();
  startDocumentLifecycle();
  first.dispose();
  recordDocumentNavigation({
    paneCount: 1,
    historyEntryCount: 1,
    savedEntryStateCount: 0,
  });
  expect(JSON.parse(sessionStorage.getItem(key)!).navigation?.commits).toBe(1);
});

it.each([
  'invalid json',
  JSON.stringify({
    frontendInstanceId: 'not-an-id',
    startedAtMs: 0,
    updatedAtMs: 0,
    visible: true,
  }),
  JSON.stringify({
    frontendInstanceId: previousId,
    startedAtMs: 110_000,
    updatedAtMs: 110_000,
    visible: true,
  }),
  JSON.stringify({
    frontendInstanceId: previousId,
    startedAtMs: 90_000,
    updatedAtMs: 80_000,
    visible: true,
  }),
])('reports malformed or future checkpoints as unavailable: %s', (saved) => {
  sessionStorage.setItem(key, saved);
  expect(startDocumentLifecycle().attributes).toMatchObject({
    previous_document_checkpoint_available: false,
    previous_document_pagehide_observed: undefined,
  });
});

it('expires stale checkpoints instead of correlating them to a later incident', () => {
  sessionStorage.setItem(
    key,
    JSON.stringify({
      frontendInstanceId: previousId,
      startedAtMs: 0,
      updatedAtMs: 0,
      visible: true,
    })
  );
  vi.setSystemTime(25 * 60 * 60_000);
  expect(
    startDocumentLifecycle().attributes.previous_document_checkpoint_available
  ).toBe(false);
});

it('tolerates unavailable session storage', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(
    startDocumentLifecycle().attributes.previous_document_checkpoint_available
  ).toBe(false);
  expect(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
  ).not.toThrow();
});
