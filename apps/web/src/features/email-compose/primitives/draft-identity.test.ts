import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type { EmailDraftStorage } from '../context/compose-capabilities';
import { createComposeContext } from '../tests/capabilities';
import { observeDraftIdentity } from './draft-identity';
import { createDraftSession } from './draft-session';

type ReadResult = Awaited<
  ReturnType<NonNullable<EmailDraftStorage['readDraft']>>
>;
type Settlement = Parameters<
  Parameters<NonNullable<EmailDraftStorage['watchDrafts']>>[0]
>[0];

function mount(
  readDraft: NonNullable<EmailDraftStorage['readDraft']>,
  seed: Parameters<typeof createDraftSession>[0] = {
    draftId: 'local',
    threadId: 'local-thread',
    persistence: 'queued',
  }
) {
  let changed!: (settlement?: Settlement) => void;
  const unsubscribe = vi.fn();
  const report = vi.fn();
  const root = createRoot((dispose) => {
    const session = createDraftSession(seed);
    observeDraftIdentity(
      {
        ...createComposeContext().drafts,
        readDraft,
        watchDrafts: (callback) => {
          changed = callback;
          return unsubscribe;
        },
      },
      session,
      report
    );
    return { dispose, session };
  });
  return {
    ...root,
    changed: (settlement?: Settlement) => changed(settlement),
    unsubscribe,
    report,
  };
}

describe('durable draft identity', () => {
  it('starts observation when the queue activates and ignores reads after it deactivates', async () => {
    const [enabled, setEnabled] = createSignal(false);
    const pending = Promise.withResolvers<ReadResult>();
    const read = vi.fn(
      async (): Promise<ReadResult> => ({
        draft: message('server'),
        persistence: 'committed',
      })
    );
    const unsubscribe = vi.fn();
    let changed!: () => void;
    const watch = vi.fn((callback: () => void) => {
      changed = callback;
      return unsubscribe;
    });
    const root = createRoot((dispose) => {
      const session = createDraftSession({
        draftId: 'local',
        threadId: 'thread',
        persistence: 'queued',
      });
      observeDraftIdentity(
        {
          ...createComposeContext().drafts,
          get readDraft() {
            return enabled() ? read : undefined;
          },
          get watchDrafts() {
            return enabled() ? watch : undefined;
          },
        },
        session,
        vi.fn()
      );
      return { dispose, session };
    });
    try {
      expect(watch).not.toHaveBeenCalled();
      setEnabled(true);
      await vi.waitFor(() => expect(root.session.serverConfirmed()).toBe(true));
      expect(root.session.draftId()).toBe('server');
      expect(watch).toHaveBeenCalledOnce();
      read.mockReturnValueOnce(pending.promise);
      changed();
      setEnabled(false);
      expect(unsubscribe).toHaveBeenCalledOnce();
      pending.resolve({ draft: message('stale'), persistence: 'committed' });
      await pending.promise;
      expect(root.session.draftId()).toBe('server');
      setEnabled(true);
      expect(watch).toHaveBeenCalledTimes(2);
    } finally {
      root.dispose();
    }
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('marks a committed seed queued when local storage reports a pending save', async () => {
    const root = mount(
      async () => ({ draft: message('existing'), persistence: 'queued' }),
      { draftId: 'existing', threadId: 'thread', persistence: 'committed' }
    );
    try {
      expect(root.session.serverConfirmed()).toBe(true);
      await vi.waitFor(() =>
        expect(root.session.serverConfirmed()).toBe(false)
      );
      expect(root.session.draftId()).toBe('existing');
    } finally {
      root.dispose();
    }
  });

  it('adopts settlement IDs and unblocks send without repeatedly reading the cache', async () => {
    const read = vi.fn(
      async (): Promise<ReadResult> => ({
        draft: message('server', {
          thread_db_id: 'server-thread',
          is_draft: true,
        }),
        persistence: 'committed',
        mutationUuid: 'local',
      })
    );
    const root = mount(read);
    expect(root.session.serverConfirmed()).toBe(false);
    await vi.waitFor(() => expect(root.session.serverConfirmed()).toBe(true));
    expect(root.session.draftId()).toBe('server');
    expect(root.session.threadId()).toBe('server-thread');
    await Promise.resolve();
    expect(read.mock.calls.length).toBeLessThanOrEqual(2);
    root.dispose();
    expect(root.unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not adopt a response from before the composer reset or unmounted', async () => {
    for (const action of ['reset', 'dispose'] as const) {
      let resolve!: (result: ReadResult) => void;
      const read = vi.fn(
        () =>
          new Promise<ReadResult>((done) => {
            resolve = done;
          })
      );
      const root = mount(read);
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      if (action === 'reset') root.session.dispatch({ type: 'reset' });
      else root.dispose();
      resolve({ draft: message('late-server'), persistence: 'committed' });
      await Promise.resolve();
      expect(root.session.serverConfirmed()).toBe(false);
      expect(root.session.draftId()).not.toBe('late-server');
      if (action === 'reset') root.dispose();
    }
  });

  it('recognizes a rejection under the original handle that lands before the first read', async () => {
    let resolve!: (result: ReadResult) => void;
    const read = vi.fn(
      () =>
        new Promise<ReadResult>((done) => {
          resolve = done;
        })
    );
    const root = mount(read, { draftId: 'server', persistence: 'committed' });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    root.changed({ mutationUuid: 'local', failed: true });
    expect(root.session.autosaveAllowed()).toBe(true);
    resolve({
      draft: message('server', { is_draft: true }),
      persistence: 'queued',
      mutationUuid: 'local',
    });
    await vi.waitFor(() => expect(root.session.autosaveAllowed()).toBe(false));
    expect(root.report).toHaveBeenCalledOnce();
    root.dispose();
  });

  it('keeps a rebased edit queued and reports only its own rejected settlement', async () => {
    const root = mount(async () => ({
      draft: message('server', {
        thread_db_id: 'server-thread',
        is_draft: true,
      }),
      persistence: 'queued',
      mutationUuid: 'local',
    }));
    await vi.waitFor(() => expect(root.session.draftId()).toBe('server'));
    expect(root.session.serverConfirmed()).toBe(false);
    root.changed({ mutationUuid: 'unrelated', failed: true });
    await new Promise((settle) => setTimeout(settle));
    expect(root.session.autosaveAllowed()).toBe(true);
    root.changed({ mutationUuid: 'local', failed: true });
    await vi.waitFor(() => expect(root.session.autosaveAllowed()).toBe(false));
    expect(root.report).toHaveBeenCalledOnce();
    root.dispose();
  });
});
