import type { GraphicsEditor } from '@macro-inc/graphics';
import { createSignal } from 'solid-js';
import type { CanvasDocumentSource } from '../context/document-source';
import type { CanvasFile } from '../core/document-format';

export function createDocumentPersistence(
  editor: GraphicsEditor,
  initial: CanvasFile,
  source: CanvasDocumentSource
) {
  const [status, setStatus] = createSignal<
    'saved' | 'pending' | 'saving' | 'error'
  >('saved');
  const [savedFile, setSavedFile] = createSignal<Blob>();
  let saved = editor.document;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let disposed = false;
  const dirty = () => editor.document !== saved;
  async function drain() {
    while (dirty() && source.canEdit()) {
      const snapshot = editor.document;
      setStatus('saving');
      try {
        const file = await source.save({ ...initial, document: snapshot });
        saved = snapshot;
        setSavedFile(file);
      } catch {
        setStatus('error');
        return;
      }
    }
    setStatus(dirty() ? 'pending' : 'saved');
  }
  function flush(): Promise<void> {
    clearTimeout(timer);
    if (running) return running;
    running = drain();
    return finishRun(running);
  }
  async function finishRun(promise: Promise<void>) {
    try {
      await promise;
    } finally {
      running = undefined;
    }
  }
  const unsubscribe = editor.subscribeDocument(() => {
    if (disposed) return;
    if (!dirty()) {
      clearTimeout(timer);
      setStatus(running ? 'saving' : 'saved');
      return;
    }
    if (!source.canEdit()) return;
    setStatus('pending');
    clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, 500);
  });
  return {
    status,
    savedFile,
    dirty,
    flush,
    dispose() {
      disposed = true;
      unsubscribe();
      clearTimeout(timer);
      // The captured source keeps this document's identity even after navigation.
      void flush();
    },
  };
}
