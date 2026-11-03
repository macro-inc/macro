import 'fake-indexeddb/auto';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  defineRoute,
  type MemoryHistory,
  type SplitPanePolicy,
  SplitRouter,
  type SplitRoutes,
} from '@app/lib/split-router';
import { readEmailDraft } from '@queries/email/draft-queue';
import { saveLocalDraft } from '@queries/email/local-drafts';
import { cleanup, render } from '@solidjs/testing-library';
import { createEffect, createRoot, For, onCleanup, onMount } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { message } from '../email-message/tests/messages';
import {
  composeDraftSearch,
  createComposeRouteDraft,
} from './compose-route-draft';
import type {
  EmailComposeContext,
  EmailInbox,
  PersistedEmailIdentity,
  SaveEmailDraft,
} from './context/compose-capabilities';
import { createComposeContext } from './tests/capabilities';
import { mountEmailComposer } from './tests/composer';

vi.mock('@app/lib/analytics', () => ({
  analytics: { track: vi.fn(), posthog: { captureException: vi.fn() } },
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    getQueryData: () => ({ authenticated: true, id: 'owner' }),
  },
}));

let route: ReturnType<typeof createComposeRouteDraft> | undefined;
let mounts = 0;

function ComposeRoute() {
  route = createComposeRouteDraft();
  onMount(() => {
    mounts += 1;
  });
  return null;
}

/** The app serves compose from the legacy `component/:id` route, which accepts any search. */
const routes: SplitRoutes = {
  definitions: [
    defineRoute({
      id: 'app',
      children: [
        defineRoute({
          id: 'email-compose',
          path: 'component/email-compose',
          search: [composeDraftSearch.namespace],
          component: ComposeRoute,
        }),
      ],
    }),
  ],
  defaultRoute: () => ({
    matches: [
      { id: 'app', params: {} },
      { id: 'email-compose', params: {} },
    ],
  }),
};

const policy: SplitPanePolicy = {
  placeNewPane: ({ panes }) => ({ insertAt: panes.length }),
  closeAction: () => ({ type: 'keep' }),
  activate: () => {},
};

function renderComposeRoute(url: string): MemoryHistory {
  const history = createMemoryHistory(url);
  render(() => {
    const router = createSplitRouter({
      routes,
      history,
      paneStore: createMemoryPaneStore(),
      policy,
    });
    onCleanup(() => router.dispose());
    return (
      <SplitRouter.Root router={router}>
        <For each={router.panes()}>
          {(pane) => <SplitRouter.Outlet pane={pane} />}
        </For>
      </SplitRouter.Root>
    );
  });
  return history;
}

function routeShows(compose: ReturnType<typeof createComposeRouteDraft>) {
  return (draftId: string) => {
    const shown = Promise.withResolvers<void>();
    createRoot((dispose) =>
      createEffect(() => {
        if (compose.draftId() !== draftId) return;
        dispose();
        shown.resolve();
      })
    );
    return shown.promise;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  route = undefined;
  mounts = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const outlook: EmailInbox = {
  id: 'outlook',
  email_address: 'teo@outlook.example',
  provider: 'OUTLOOK',
  settings: {},
};
const gmail: EmailInbox = {
  id: 'gmail',
  email_address: 'teo@gmail.example',
  provider: 'GMAIL',
  settings: {},
};

it.each([
  ['Outlook', outlook, gmail],
  ['Gmail', gmail, outlook],
] as const)(
  'reopens a new %s compose with its From after a reload, once the server confirms it',
  async (_provider, from, primary) => {
    const history = renderComposeRoute('/component/email-compose');
    const compose = route!;
    const context = createComposeContext();
    context.accounts.inboxes = () => [primary, from];
    context.accounts.primaryId = () => primary.id;
    const saving = Promise.withResolvers<SaveEmailDraft>();
    const confirmation = Promise.withResolvers<PersistedEmailIdentity>();
    context.drafts.saveDraft = vi.fn((input) => {
      saving.resolve(input);
      return confirmation.promise;
    });
    const composer = mountEmailComposer(
      context,
      { recordDraft: compose.record },
      { initialInboxId: from.id }
    );
    composer.edit('Keep this draft');
    await vi.advanceTimersByTimeAsync(600);
    const saved = await saving.promise;
    expect(compose.draftId()).toBeUndefined();

    confirmation.resolve({
      draftId: 'draft',
      threadId: 'thread',
      inboxId: saved.inboxId ?? '',
    });
    await routeShows(compose)('draft');
    expect(history.entries()).toHaveLength(1);
    expect(mounts).toBe(1);
    composer.dispose();

    const { path, search } = history.entries()[history.index()]!;
    cleanup();
    renderComposeRoute(`${path}${search}`);
    const reopened = route!.draftId();
    expect(reopened).toBe('draft');
    const restored = mountEmailComposer(context, undefined, {
      draftId: reopened,
      draft: message('draft', {
        is_draft: true,
        link_id: saved.inboxId,
        from: { email: saved.draft.sender_email ?? '' },
      }),
    });
    expect(restored.state.context.fromAddress?.()).toBe(from.email_address);
    restored.dispose();
  }
);

it.each([
  ['Outlook', 'Gmail', outlook, gmail],
  ['Gmail', 'Outlook', gmail, outlook],
] as const)(
  'keeps a compose open on its route when From moves it from %s to %s',
  async (_from, _to, source, destination) => {
    const history = renderComposeRoute('/component/email-compose');
    const compose = route!;
    const context = createComposeContext();
    context.accounts.inboxes = () => [source, destination];
    context.accounts.primaryId = () => source.id;
    context.drafts.saveDraft = vi.fn(async (input) => ({
      draftId: input.draft.db_id ?? 'draft',
      threadId: input.draft.thread_db_id ?? 'thread',
      inboxId: input.inboxId ?? source.id,
    }));
    const composer = mountEmailComposer(
      context,
      { recordDraft: compose.record },
      {
        draft: message('draft', {
          is_draft: true,
          link_id: source.id,
          from: { email: source.email_address },
        }),
      }
    );
    await routeShows(compose)('draft');

    composer.state.context.onSelectInbox?.(destination.id);
    await routeShows(compose)('moved-draft');
    expect(history.entries()).toHaveLength(1);
    expect(mounts).toBe(1);
    composer.dispose();
  }
);

function reloadComposeRoute(history: MemoryHistory): MemoryHistory {
  const { path, search } = history.entries()[history.index()]!;
  cleanup();
  return renderComposeRoute(`${path}${search}`);
}

/** Reads the route's draft from this device the way the compose view does. */
async function reopenFromRoute(context: EmailComposeContext) {
  const compose = route!;
  const draftId = compose.draftId();
  const saved = draftId ? await readEmailDraft(draftId) : undefined;
  return {
    persistence: saved?.persistence,
    composer: mountEmailComposer(
      context,
      { recordDraft: compose.record },
      {
        draftId,
        draft: saved?.draft,
        draftPersistence: saved?.persistence,
        localDraft: saved?.local,
      }
    ),
  };
}

it.each([
  ['Outlook', outlook, gmail],
  ['Gmail', gmail, outlook],
] as const)(
  'reopens a queued %s draft from its route after two reloads, before the server confirms it',
  async (_provider, from, primary) => {
    vi.useRealTimers();
    const draftId = `${from.id}-draft`;
    const context = createComposeContext();
    context.accounts.inboxes = () => [primary, from];
    context.accounts.primaryId = () => primary.id;
    context.drafts.saveLocalDraft = (input) =>
      saveLocalDraft({ ...input, senderEmail: from.email_address });
    const queued = Promise.withResolvers<void>();
    context.drafts.saveDraft = vi.fn(async (input) => {
      queued.resolve();
      return {
        draftId: input.draft.db_id ?? draftId,
        threadId: input.draft.thread_db_id ?? 'thread',
        inboxId: input.inboxId ?? from.id,
        persistence: 'queued' as const,
      };
    });
    let history = renderComposeRoute('/component/email-compose');
    const opened = mountEmailComposer(
      context,
      { recordDraft: route!.record },
      {
        draft: message(draftId, {
          is_draft: true,
          link_id: from.id,
          from: { email: from.email_address },
        }),
      }
    );
    await routeShows(route!)(draftId);
    opened.edit('Edited offline');
    await queued.promise;
    await opened.state.flushLocal();
    opened.dispose();

    context.drafts.saveDraft = vi.fn(() => new Promise<never>(() => {}));
    history = reloadComposeRoute(history);
    const firstReload = await reopenFromRoute(context);
    expect(firstReload.persistence).toBe('queued');
    firstReload.composer.dispose();

    reloadComposeRoute(history);
    const secondReload = await reopenFromRoute(context);
    expect(route!.draftId()).toBe(draftId);
    expect(secondReload.composer.state.context.fromAddress?.()).toBe(
      from.email_address
    );
    secondReload.composer.dispose();
  }
);
