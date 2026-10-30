import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type {
  ComposeNoticeOptions,
  EmailInbox,
  SaveEmailDraft,
} from '../context/compose-capabilities';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

vi.mock('@app/lib/analytics', () => ({
  analytics: { track: vi.fn(), posthog: { captureException: vi.fn() } },
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    getQueryData: () => ({ authenticated: true, id: 'owner' }),
  },
}));

let localDrafts: typeof import('@queries/email/local-drafts');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  localDrafts = await import('@queries/email/local-drafts');
});
afterEach(async () => {
  await localDrafts.localDraftStore.close();
  vi.unstubAllGlobals();
});

const outlook: EmailInbox = {
  id: 'inbox',
  email_address: 'teo@outlook.example',
  provider: 'OUTLOOK',
  settings: {},
};
const gmail: EmailInbox = {
  id: 'inbox',
  email_address: 'teo@gmail.example',
  provider: 'GMAIL',
  settings: {},
};

/** Production keeps working copies in IndexedDB; only the network is faked. */
function createDeviceContext(source: EmailInbox, destination: EmailInbox) {
  const context = createComposeContext();
  const inboxes = [source, { ...destination, id: 'other' }];
  context.accounts.inboxes = () => inboxes;
  context.drafts.saveLocalDraft = (input) =>
    localDrafts.saveLocalDraft({
      ...input,
      senderEmail: inboxes.find((inbox) => inbox.id === input.inboxId)
        ?.email_address,
    });
  const forgotten = Promise.withResolvers<string>();
  context.drafts.forgetLocalDraft = async (draftId) => {
    await localDrafts.forgetLocalDraft(draftId);
    forgotten.resolve(draftId);
  };
  const moved = Promise.withResolvers<
    { saved: SaveEmailDraft } | { failed: string; reason?: string }
  >();
  context.drafts.saveDraft = vi.fn(async (input) => {
    if (input.inboxId === 'other') moved.resolve({ saved: input });
    return {
      draftId: input.draft.db_id ?? 'draft',
      threadId: input.draft.thread_db_id ?? 'thread',
      inboxId: input.inboxId ?? 'inbox',
    };
  });
  context.notices.feedback.failure = vi.fn(
    (failed: string, options?: ComposeNoticeOptions) => {
      moved.resolve({ failed, reason: options?.subtext });
      return undefined;
    }
  );
  return { context, moved: moved.promise, forgotten: forgotten.promise };
}

const directions = [
  ['Outlook', 'Gmail', outlook, gmail],
  ['Gmail', 'Outlook', gmail, outlook],
] as const;

it.each(directions)(
  'keeps saving a draft locally after its sender moves it from %s to %s',
  async (_from, _to, source, destination) => {
    const { context, moved, forgotten } = createDeviceContext(
      source,
      destination
    );
    const root = mountEmailComposer(context, undefined, {
      draft: message('draft', {
        is_draft: true,
        link_id: 'inbox',
        from: { email: source.email_address },
      }),
    });
    try {
      root.edit('Before the move');
      await root.state.flushLocal();
      root.state.context.onSelectInbox?.('other');
      expect(await moved).toEqual({
        saved: expect.objectContaining({
          inboxId: 'other',
          draft: expect.objectContaining({ db_id: 'moved-draft' }),
        }),
      });
      expect(root.state.localSaveState()).toBe('saved');
      expect(await localDrafts.readLocalDraft('moved-draft')).toMatchObject({
        inboxId: 'other',
        content: { sender_email: destination.email_address },
      });
      expect(await forgotten).toBe('draft');
      expect(await localDrafts.readLocalDraft('draft')).toBeUndefined();
    } finally {
      root.dispose();
    }
  }
);

it.each(directions)(
  'shows the moved draft from %s to %s and still saves its new sender',
  async (_from, _to, source, destination) => {
    const { context, moved } = createDeviceContext(source, destination);
    const showMovedDraft = vi.fn();
    // A thread route shows the moved draft by unmounting this composer.
    const root = mountEmailComposer(
      context,
      {
        showMovedDraft: (draft) => {
          showMovedDraft(draft);
          root.dispose();
        },
      },
      {
        draft: message('draft', {
          is_draft: true,
          link_id: 'inbox',
          from: { email: source.email_address },
        }),
      }
    );
    root.edit('Moving draft');
    await root.state.flushLocal();
    root.state.context.onSelectInbox?.('other');
    expect(await moved).toEqual({
      saved: expect.objectContaining({
        inboxId: 'other',
        draft: expect.objectContaining({
          db_id: 'moved-draft',
          sender_email: destination.email_address,
        }),
      }),
    });
    expect(showMovedDraft).toHaveBeenCalledExactlyOnceWith({
      draftId: 'moved-draft',
      threadId: 'moved-thread',
    });
  }
);

it.each(directions)(
  'keeps a draft moved from %s to %s when the host cannot show it',
  async (_from, _to, source, destination) => {
    const { context, moved } = createDeviceContext(source, destination);
    const navigation = new Error('Could not open the moved thread');
    const root = mountEmailComposer(
      context,
      {
        showMovedDraft: () => {
          throw navigation;
        },
      },
      {
        draft: message('draft', {
          is_draft: true,
          link_id: 'inbox',
          from: { email: source.email_address },
        }),
      }
    );
    try {
      root.edit('Moving draft');
      await root.state.flushLocal();
      root.state.context.onSelectInbox?.('other');
      expect(await moved).toEqual({
        saved: expect.objectContaining({
          inboxId: 'other',
          draft: expect.objectContaining({
            db_id: 'moved-draft',
            sender_email: destination.email_address,
          }),
        }),
      });
      expect(context.notices.feedback.failure).not.toHaveBeenCalled();
      expect(context.notices.reportError).toHaveBeenCalledWith(navigation);
    } finally {
      root.dispose();
    }
  }
);

it.each(directions)(
  'keeps saving a reply locally after its sender moves it from %s to %s',
  async (_from, _to, source, destination) => {
    const { context, moved, forgotten } = createDeviceContext(
      source,
      destination
    );
    const reply = mountReplyComposer(context, undefined, {
      draft: message('draft', {
        is_draft: true,
        link_id: 'inbox',
        replying_to_id: 'parent',
        from: { email: source.email_address },
      }),
    });
    try {
      reply.edit('Before the move');
      await reply.flushLocal();
      reply.persistDraftOnSenderSwitch('other');
      expect(await moved).toEqual({
        saved: expect.objectContaining({
          inboxId: 'other',
          draft: expect.objectContaining({ db_id: 'moved-draft' }),
        }),
      });
      expect(reply.localSaveState()).toBe('saved');
      expect(await localDrafts.readLocalDraft('moved-draft')).toMatchObject({
        inboxId: 'other',
        content: { sender_email: destination.email_address },
      });
      expect(await forgotten).toBe('draft');
      expect(await localDrafts.readLocalDraft('draft')).toBeUndefined();
    } finally {
      reply.dispose();
    }
  }
);
