import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type { EmailDraftRestoration } from '../context/compose-capabilities';
import { createComposeContext } from '../tests/capabilities';
import { observeDraftRestoration } from './draft-restoration';

const change: EmailDraftRestoration = {
  draftId: 'draft',
  originalDraftId: 'local-draft',
  threadId: 'thread',
  inboxId: 'inbox',
};
const result = {
  draft: message('draft', { is_draft: true }),
  persistence: 'queued' as const,
};

function mountRestoration(readyInitially = false) {
  const context = createComposeContext();
  const [ready, setReady] = createSignal(readyInitially);
  let version = 0;
  let listener: ((event: EmailDraftRestoration) => void) | undefined;
  const read = vi.fn(async () => result);
  const restored = vi.fn();
  const setPending = vi.fn();
  const cancelPendingSave = vi.fn(() => {
    version += 1;
  });
  context.drafts.readDraft = read;
  context.drafts.watchRestorations = (changed) => {
    listener = changed;
    return () => {
      listener = undefined;
    };
  };
  const dispose = createRoot((dispose) => {
    observeDraftRestoration({
      storage: context.drafts,
      accepts: (event) => event.draftId === 'draft',
      ready,
      version: () => String(version),
      cancelPendingSave,
      setPending,
      restore: restored,
      reportError: context.notices.reportError,
    });
    return dispose;
  });
  return {
    read,
    restored,
    setPending,
    cancelPendingSave,
    setReady,
    emit: (event = change) => listener?.(event),
    changeSession: () => {
      version += 1;
    },
    dispose,
  };
}

it('discards a buffered restoration when the same draft starts a newer editor session', () => {
  const root = mountRestoration();
  try {
    root.emit();
    expect(root.cancelPendingSave).toHaveBeenCalledOnce();
    expect(root.setPending).toHaveBeenLastCalledWith(true);
    root.changeSession();
    root.setReady(true);
    expect(root.read).not.toHaveBeenCalled();
    expect(root.restored).not.toHaveBeenCalled();
    expect(root.setPending).toHaveBeenLastCalledWith(false);
  } finally {
    root.dispose();
  }
});

it('discards a buffered restoration when the editor unmounts before journal unlock', () => {
  const root = mountRestoration();
  root.emit();
  root.dispose();
  root.setReady(true);
  expect(root.read).not.toHaveBeenCalled();
  expect(root.restored).not.toHaveBeenCalled();
  expect(root.setPending).toHaveBeenLastCalledWith(false);
});

it('waits for another unlock if the journal locks again during the draft read', async () => {
  const root = mountRestoration(true);
  const firstRead = Promise.withResolvers<typeof result>();
  root.read.mockReturnValueOnce(firstRead.promise);
  try {
    root.emit();
    root.setReady(false);
    firstRead.resolve(result);
    await firstRead.promise;
    expect(root.restored).not.toHaveBeenCalled();
    expect(root.setPending).toHaveBeenLastCalledWith(true);
    root.setReady(true);
    await vi.waitFor(() => expect(root.restored).toHaveBeenCalledOnce());
    expect(root.read).toHaveBeenCalledTimes(2);
    expect(root.setPending).toHaveBeenLastCalledWith(false);
  } finally {
    root.dispose();
  }
});

it('keeps the latest restoration when an older draft read finishes afterward', async () => {
  const root = mountRestoration(true);
  const firstRead = Promise.withResolvers<typeof result>();
  root.read.mockReturnValueOnce(firstRead.promise);
  try {
    root.emit();
    const newerChange = { ...change, includeSignature: false };
    root.emit(newerChange);
    await vi.waitFor(() => expect(root.restored).toHaveBeenCalledOnce());
    expect(root.restored).toHaveBeenCalledWith(
      result.draft,
      newerChange,
      'queued',
      undefined,
      undefined
    );
    firstRead.resolve(result);
    await firstRead.promise;
    expect(root.restored).toHaveBeenCalledOnce();
  } finally {
    root.dispose();
  }
});
