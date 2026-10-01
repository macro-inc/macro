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
  const recover = vi.fn();
  const alreadySent = vi.fn();
  const notices = { ...createComposeContext().notices, reportError: report };
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
      notices,
      recover,
      alreadySent
    );
    return { dispose, session };
  });
  return {
    ...root,
    changed: (settlement?: Settlement) => changed(settlement),
    unsubscribe,
    report,
    recover,
    alreadySent,
    notices,
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
        createComposeContext().notices,
        vi.fn(),
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
          link_id: 'server-inbox',
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
    expect(root.session.inboxId()).toBe('server-inbox');
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

it('offers one explicit recovery and dismisses it when the session resets', async () => {
  const root = mount(async () => ({
    draft: message('local', { is_draft: true }),
    persistence: 'queued',
    mutationUuid: 'local',
  }));
  vi.mocked(root.notices.feedback.failure).mockReturnValue(42);
  root.recover.mockImplementation(() =>
    root.session.dispatch({ type: 'reset' })
  );
  try {
    await Promise.resolve();
    root.changed({ mutationUuid: 'local', failed: true });
    await vi.waitFor(() =>
      expect(root.notices.feedback.failure).toHaveBeenCalledOnce()
    );
    expect(root.session.autosaveAllowed()).toBe(false);
    expect(root.recover).not.toHaveBeenCalled();
    root.changed({ mutationUuid: 'local', failed: true });
    await Promise.resolve();
    expect(root.notices.feedback.failure).toHaveBeenCalledOnce();
    const [, notice] = vi.mocked(root.notices.feedback.failure).mock.calls[0];
    expect(notice?.persistent).toBe(true);
    const action = notice?.actions?.[0];
    expect(action?.label).toBe('Save as new draft');
    action?.onClick();
    expect(root.recover).toHaveBeenCalledOnce();
    expect(root.session.autosaveAllowed()).toBe(true);
    expect(root.notices.feedback.dismiss).toHaveBeenCalledWith(42);
    action?.onClick();
    expect(root.recover).toHaveBeenCalledOnce();
  } finally {
    root.dispose();
  }
});

it('dismisses recovery on disposal and ignores its stale action', async () => {
  const root = mount(async () => ({
    draft: message('local'),
    persistence: 'queued',
  }));
  vi.mocked(root.notices.feedback.failure).mockReturnValue(42);
  root.changed({ mutationUuid: 'local', failed: true });
  await vi.waitFor(() =>
    expect(root.notices.feedback.failure).toHaveBeenCalledOnce()
  );
  const action = vi.mocked(root.notices.feedback.failure).mock.calls[0][1]
    ?.actions?.[0];
  root.dispose();
  expect(root.notices.feedback.dismiss).toHaveBeenCalledWith(42);
  action?.onClick();
  expect(root.recover).not.toHaveBeenCalled();
});

it.each(['reset', 'dispose'] as const)(
  'ignores a failed settlement waiting for identity after %s',
  async (action) => {
    const pending = Promise.withResolvers<ReadResult>();
    const root = mount(() => pending.promise);
    root.changed({ mutationUuid: 'local', failed: true });
    if (action === 'reset') root.session.dispatch({ type: 'reset' });
    else root.dispose();
    pending.resolve({
      draft: message('local'),
      persistence: 'queued',
      mutationUuid: 'local',
    });
    await pending.promise;
    await Promise.resolve();
    expect(root.notices.feedback.failure).not.toHaveBeenCalled();
    if (action === 'reset') {
      expect(root.session.autosaveAllowed()).toBe(true);
      root.dispose();
    }
  }
);

it('clears an already-sent draft without offering recovery, even after another rejection', async () => {
  const root = mount(async () => ({
    draft: message('server', { is_draft: true }),
    persistence: 'queued',
    mutationUuid: 'local',
  }));
  vi.mocked(root.notices.feedback.failure).mockReturnValue(42);
  try {
    await vi.waitFor(() => expect(root.session.draftId()).toBe('server'));
    root.changed({ mutationUuid: 'local', failed: true, code: 'INVALID' });
    await vi.waitFor(() => expect(root.session.autosaveAllowed()).toBe(false));
    const recovery = vi.mocked(root.notices.feedback.failure).mock.calls[0][1]
      ?.actions?.[0];
    root.changed({
      mutationUuid: 'local',
      failed: true,
      code: 'DRAFT_ALREADY_SENT',
    });
    await vi.waitFor(() => expect(root.alreadySent).toHaveBeenCalledOnce());
    expect(root.session.draftId()).toBeUndefined();
    expect(root.session.autosaveAllowed()).toBe(true);
    expect(root.notices.feedback.dismiss).toHaveBeenCalledWith(42);
    recovery?.onClick();
    expect(root.recover).not.toHaveBeenCalled();
    root.changed({
      mutationUuid: 'local',
      failed: true,
      code: 'DRAFT_ALREADY_SENT',
    });
    await Promise.resolve();
    expect(root.alreadySent).toHaveBeenCalledOnce();
  } finally {
    root.dispose();
  }
});

it.each([
  'INVALID',
  'NOT_FOUND',
  'INBOX_NOT_FOUND',
  'UNAUTHORIZED',
  'INTERNAL',
] as const)(
  'preserves the %s rejection code for background saves',
  async (code) => {
    const root = mount(async () => undefined);
    try {
      root.changed({ mutationUuid: 'local', failed: true, code });
      await vi.waitFor(() =>
        expect(root.session.state().policy).toEqual({ kind: 'latched', code })
      );
      expect(root.alreadySent).not.toHaveBeenCalled();
      expect(root.notices.feedback.failure).toHaveBeenCalledOnce();
    } finally {
      root.dispose();
    }
  }
);

it.each(['draft', 'sent'] as const)(
  'handles an already-sent original handle when the first read exposes a %s record',
  async (record) => {
    const pending = Promise.withResolvers<ReadResult>();
    const root = mount(() => pending.promise, {
      draftId: 'server',
      persistence: 'committed',
    });
    try {
      root.changed({
        mutationUuid: 'local',
        failed: true,
        code: 'DRAFT_ALREADY_SENT',
      });
      expect(root.alreadySent).not.toHaveBeenCalled();
      pending.resolve({
        draft:
          record === 'draft'
            ? message('server', { is_draft: true })
            : undefined,
        persistence: record === 'draft' ? 'queued' : 'committed',
        mutationUuid: 'local',
      });
      await vi.waitFor(() => expect(root.alreadySent).toHaveBeenCalledOnce());
      expect(root.session.draftId()).toBeUndefined();
      expect(root.notices.feedback.failure).not.toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  }
);

it.each(['reset', 'dispose'] as const)(
  'ignores already-sent failure racing identity lookup after %s',
  async (action) => {
    const pending = Promise.withResolvers<ReadResult>();
    const root = mount(async (draftId) =>
      draftId === 'local' ? pending.promise : undefined
    );
    root.changed({
      mutationUuid: 'local',
      failed: true,
      code: 'DRAFT_ALREADY_SENT',
    });
    if (action === 'dispose') root.dispose();
    else {
      root.session.dispatch({ type: 'reset' });
      root.session.dispatch({ type: 'minted', draftId: 'new-draft' });
    }
    pending.resolve({
      draft: message('local'),
      persistence: 'queued',
      mutationUuid: 'local',
    });
    await pending.promise;
    await Promise.resolve();
    expect(root.alreadySent).not.toHaveBeenCalled();
    expect(root.notices.feedback.failure).not.toHaveBeenCalled();
    if (action === 'reset') {
      expect(root.session.draftId()).toBe('new-draft');
      root.dispose();
    }
  }
);

it('waits for a replacement identity read before correlating an already-sent failure', async () => {
  const first = Promise.withResolvers<ReadResult>();
  const second = Promise.withResolvers<ReadResult>();
  const read = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValue(second.promise);
  const root = mount(read, { draftId: 'server', persistence: 'committed' });
  const sent: ReadResult = { persistence: 'committed', mutationUuid: 'local' };
  try {
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    root.changed({
      mutationUuid: 'local',
      failed: true,
      code: 'DRAFT_ALREADY_SENT',
    });
    root.changed();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    first.resolve(sent);
    await first.promise;
    await Promise.resolve();
    expect(root.alreadySent).not.toHaveBeenCalled();
    second.resolve(sent);
    await vi.waitFor(() => expect(root.alreadySent).toHaveBeenCalledOnce());
    expect(root.session.draftId()).toBeUndefined();
    expect(root.notices.feedback.failure).not.toHaveBeenCalled();
  } finally {
    root.dispose();
  }
});
