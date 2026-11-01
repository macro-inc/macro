import 'fake-indexeddb/auto';
import * as draftQueue from '@queries/email/draft-queue';
import * as confirmation from '@queries/email/local-draft-confirmation';
import * as localDrafts from '@queries/email/local-drafts';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  EmailInbox,
  SaveEmailDraft,
} from '../context/compose-capabilities';
import { useCompose } from '../context/compose-context';
import { createComposeContext } from '../tests/capabilities';
import { createEmailEditor, setEmailEditorText } from '../tests/editor';
import { EmailComposeView } from './email-compose';

vi.mock('@app/lib/analytics', () => ({
  analytics: { track: vi.fn(), posthog: { captureException: vi.fn() } },
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    getQueryData: () => ({ authenticated: true, id: 'owner' }),
    invalidateQueries: vi.fn(async () => {}),
  },
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn(), info: vi.fn() },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  assertEmailDraftQueueAvailable: () => {},
  dssGraphqlFetch: vi.fn(),
  getGraphqlCacheHost: () => undefined,
  getGraphqlSoupClient: () => undefined,
  graphqlCacheEnabled: () => true,
  graphqlCacheRecoveryState: () => undefined,
  graphqlDraftQueueBlocked: () => false,
  retryGraphqlCacheInitialization: async () => {},
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: () => null,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  SplitHeaderBadge: () => null,
  StaticSplitLabel: () => null,
}));
vi.mock('@core/mobile/WrapUnlessMobile', () => ({
  WrapUnlessMobile: (props: ParentProps) => props.children,
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
  useHotkeyDOMScope: () => [vi.fn(), 'compose-email'],
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'me@example.com',
  useUserId: () => () => 'macro|me@example.com',
}));
vi.mock('@core/user/dmActivity', () => ({
  useAugmentUserWithDmActivity: () => (user: unknown) => user,
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: JSX.Element }) => <>{props.trigger}</>,
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('virtua/solid', async () => {
  const { For } = await import('solid-js');
  return {
    VList: (props: {
      data: unknown[];
      children: (item: unknown) => JSX.Element;
    }) => <For each={props.data}>{props.children}</For>,
  };
});
vi.mock('../components/signature-preview', () => ({
  SignaturePreview: () => null,
}));
vi.mock('../components/email-schedule-summary', () => ({
  EmailScheduleBar: () => null,
}));
vi.mock('./compose-toolbar', () => ({ EmailComposeToolbar: () => null }));
// The rich text editor is out of scope; the body only needs to take typing.
vi.mock('./compose-body', () => ({
  ComposeBody: () => {
    const state = useCompose();
    const editor = createEmailEditor();
    state.captureEditor(editor);
    state.onContentChange('');
    return (
      <textarea
        aria-label="Message"
        onInput={(event) => {
          setEmailEditorText(editor, event.currentTarget.value);
          state.onContentChange(event.currentTarget.value);
        }}
      />
    );
  },
}));

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(async () => {
  cleanup();
  await localDrafts.localDraftStore.close();
  vi.unstubAllGlobals();
});

const providers: [string, EmailInbox][] = [
  [
    'Gmail',
    {
      id: 'inbox',
      email_address: 'teo@gmail.example',
      provider: 'GMAIL',
      settings: {},
    },
  ],
  [
    'Outlook',
    {
      id: 'inbox',
      email_address: 'teo@outlook.example',
      provider: 'OUTLOOK',
      settings: {},
    },
  ],
];

/**
 * A new compose on the device's working copies. The server write is queued
 * and stays unconfirmed until the test confirms it, as it does offline.
 */
function openCompose(inbox: EmailInbox, network: { offline: boolean }) {
  const context = createComposeContext();
  context.accounts.inboxes = () => [inbox];
  context.connectivity.looksOffline = () => network.offline;
  context.drafts.saveLocalDraft = (input) =>
    localDrafts.saveLocalDraft({
      ...input,
      senderEmail: inbox.email_address,
    });
  context.drafts.readDraft = draftQueue.readEmailDraft;
  context.drafts.watchDrafts = draftQueue.watchEmailDrafts;
  const saves: SaveEmailDraft[] = [];
  context.drafts.saveDraft = vi.fn(async (input) => {
    saves.push(input);
    return {
      draftId: input.clientHandles?.draftId ?? input.draft.db_id ?? '',
      threadId: input.clientHandles?.threadId ?? input.draft.thread_db_id,
      inboxId: input.inboxId ?? inbox.id,
      persistence: 'queued' as const,
    };
  });
  render(() => <EmailComposeView context={context} />);
  return {
    saves,
    subject: screen.getByPlaceholderText<HTMLInputElement>('Subject'),
    message: screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Message',
    }),
    /** The server acknowledges the newest copy this device holds. */
    async confirmOnServer() {
      const handles = saves.at(-1)?.clientHandles;
      const local = await localDrafts.readLocalDraft(handles?.draftId ?? '');
      await confirmation.confirmLocalDraftSave(local, {
        draftId: 'server-draft',
        threadId: 'server-thread',
      });
    },
  };
}

const unsyncedNotice = () =>
  screen.queryByText('Saved on this device; waiting to sync');

it.each(providers)(
  'shows that offline edits on %s are only on this device until the server has them',
  async (_provider, inbox) => {
    const user = userEvent.setup();
    const network = { offline: true };
    const compose = openCompose(inbox, network);

    await user.click(compose.subject);
    await user.keyboard('Quarterly plan');
    await user.click(compose.message);
    await user.keyboard('Numbers attached');

    await vi.waitFor(() => expect(unsyncedNotice()).not.toBeNull(), {
      timeout: 3_000,
    });

    network.offline = false;
    await compose.confirmOnServer();
    await vi.waitFor(() => expect(unsyncedNotice()).toBeNull(), {
      timeout: 3_000,
    });
  }
);

it.each(providers)(
  'keeps saving silent on %s while online',
  async (_provider, inbox) => {
    const user = userEvent.setup();
    const compose = openCompose(inbox, { offline: false });

    await user.click(compose.subject);
    await user.keyboard('Quarterly plan');
    await user.click(compose.message);
    await user.keyboard('Numbers attached');
    await vi.waitFor(() => expect(compose.saves.length).toBeGreaterThan(0), {
      timeout: 3_000,
    });

    expect(unsyncedNotice()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  }
);
