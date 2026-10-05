import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createMarkdownOpenTracking } from './create-markdown-open-tracking';

function setup() {
  const recordOpen = vi.fn();
  let setDocumentId!: (id: string) => void;
  let setLoadedDocumentId!: (id: string | undefined) => void;
  const dispose = createRoot((dispose) => {
    const [documentId, setId] = createSignal('first');
    const [loadedDocumentId, setLoaded] = createSignal<string>();
    setDocumentId = setId;
    setLoadedDocumentId = setLoaded;
    createMarkdownOpenTracking({ documentId, loadedDocumentId, recordOpen });
    return dispose;
  });
  return { recordOpen, setDocumentId, setLoadedDocumentId, dispose };
}

describe('createMarkdownOpenTracking', () => {
  it('records one successful authorized open, not rerenders or refetches', () => {
    const open = setup();
    try {
      expect(open.recordOpen).not.toHaveBeenCalled();
      open.setLoadedDocumentId('first');
      open.setLoadedDocumentId(undefined);
      open.setLoadedDocumentId('first');
      expect(open.recordOpen).toHaveBeenCalledExactlyOnceWith('first');
    } finally {
      open.dispose();
    }
  });

  it('does not record failed loads and records a successful retry', () => {
    const open = setup();
    try {
      open.setLoadedDocumentId(undefined);
      expect(open.recordOpen).not.toHaveBeenCalled();
      open.setLoadedDocumentId('first');
      expect(open.recordOpen).toHaveBeenCalledExactlyOnceWith('first');
    } finally {
      open.dispose();
    }
  });

  it('ignores stale results and canceled navigation, then records each opened identity', () => {
    const open = setup();
    try {
      open.setDocumentId('second');
      open.setLoadedDocumentId('first');
      expect(open.recordOpen).not.toHaveBeenCalled();
      open.setLoadedDocumentId('second');
      expect(open.recordOpen).toHaveBeenCalledExactlyOnceWith('second');
      open.setDocumentId('first');
      expect(open.recordOpen).toHaveBeenCalledTimes(1);
      open.setLoadedDocumentId('first');
      expect(open.recordOpen).toHaveBeenNthCalledWith(2, 'first');
      open.dispose();
      open.setLoadedDocumentId('second');
      expect(open.recordOpen).toHaveBeenCalledTimes(2);
    } finally {
      open.dispose();
    }
  });
});
