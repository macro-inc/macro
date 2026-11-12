import '@app/index.css';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type {
  Bucket,
  ItemForBucket,
  ItemsForBuckets,
  QuickAccessContextValue,
  QuickAccessList,
  QuickAccessListOptions,
} from '@core/context/quickAccess/types';
import { TeamContextProvider } from '@core/context/team';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { EntityProvider } from '@entity';
import { createNoopLiveSyncSource } from '@macro-inc/collaboration/collab/source';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { authKeys, type UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { okAsync, ResultAsync } from 'neverthrow';
import { type Component, For, type JSX, type ParentProps } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';
import {
  MarkdownDocument,
  MarkdownDocumentContent,
} from '../component/MarkdownDocument';
import { useMarkdownDocumentTools } from '../component/useMarkdownDocumentTools';
import { useMarkdownDocument } from '../context/markdown-document-context';

const PARAMS = new URLSearchParams(location.search);

const MARKDOWN = `These notes came over from another workspace, where most pages were read at full width. Long paragraphs like this one wrap at the reading column in the standard layout, and run across the whole pane in wide mode, so a reader scrolls less to get through the same page.

## Roadmap

| Area | Owner | Status | Target | Notes |
| --- | --- | --- | --- | --- |
| Import | Platform | In progress | Q1 | Pages, databases and attachments |
| Search | Core | Planned | Q2 | Ranking and filters across every imported page |
| Mobile | Apps | Done | Q4 | Offline reading |

## Script

\`\`\`ts
export function summarize(rows: { area: string; status: string }[]): string {
  return rows.map((row) => \`\${row.area}: \${row.status}\`).join(', ');
}
\`\`\`

## Next steps

- Review the import report with each team and agree on what moves first.
- Archive the pages nobody has opened this year.
- Move the remaining planning notes before the end of the quarter.
`;

/**
 * With `?comments` in the URL, gives the document one comment so the notebook
 * lays out its margin comment column.
 */
function SeedComment() {
  if (!PARAMS.has('comments')) return null;
  const { state } = useMarkdownDocument();
  state.setCommentState('comments', 'fixture-comment', {
    id: 'fixture-comment',
    rootId: 'fixture-comment',
    threadId: 'fixture-thread',
    anchorId: 'fixture-anchor',
    owner: 'fixture-user',
    author: 'Reviewer',
    text: 'Can we split this table by quarter?',
    createdAt: null,
    isNew: false,
    children: [],
  });
  return null;
}

function Menu() {
  const { menuTools } = useMarkdownDocumentTools();
  return (
    <nav
      class="absolute right-3 top-3 z-10 flex gap-2"
      aria-label="Document menu"
    >
      <For each={menuTools.filter((tool) => tool.condition?.() !== false)}>
        {(tool) => {
          const label = () =>
            typeof tool.label === 'function' ? tool.label() : tool.label;
          return (
            <button
              type="button"
              class="flex items-center gap-1.5 rounded border border-edge bg-panel px-2 py-1 text-sm text-ink"
              onClick={() => tool.action()}
            >
              <Dynamic
                component={
                  tool.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>
                }
                class="size-4"
              />
              {label()}
            </button>
          );
        }}
      </For>
    </nav>
  );
}

function Fixture() {
  const documentId = 'wide-mode-fixture';
  const doInitialSync = () =>
    ResultAsync.fromSafePromise(markdownToLoroSnapshot(MARKDOWN)).andThen(
      (snapshot) =>
        okAsync({ snapshot: snapshot!, awareness: new Uint8Array() })
    );

  return (
    <MarkdownDocument
      documentId={documentId}
      kind="document"
      documentSource={{
        type: 'sync',
        source: createNoopLiveSyncSource(documentId),
      }}
      permissions={{ canComment: true, canEdit: true, isOwner: true }}
      persistedName="Quarterly planning notes"
      fallbackName={undefined}
    >
      <SeedComment />
      <Menu />
      <MarkdownDocumentContent doInitialSync={doInitialSync} />
    </MarkdownDocument>
  );
}

// Nothing in this document mentions other items, so Quick Access stays empty.
const EMPTY_LIST: QuickAccessList = {
  items: () => [],
  totalCount: () => 0,
  hasMore: () => false,
  isLoading: () => false,
  isLoadingMore: () => false,
  error: () => undefined,
  loadMore: async () => {},
};

function useList(): QuickAccessList;
function useList<B extends Bucket>(
  bucket: B
): QuickAccessList<ItemForBucket<B>>;
function useList<B extends Bucket[]>(
  ...buckets: B
): QuickAccessList<ItemsForBuckets<B>>;
function useList<const B extends readonly Bucket[]>(
  options: QuickAccessListOptions<B>
): QuickAccessList<ItemForBucket<B[number]>>;
function useList(): QuickAccessList {
  return EMPTY_LIST;
}

const QUICK_ACCESS: QuickAccessContextValue = {
  useList,
  usesRecordSelection: () => false,
  usesSearchProjection: () => true,
  isLoading: () => false,
  refresh: () => {},
  getById: () => undefined,
  interactionForUser: () => undefined,
};

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// With `?discussion` the viewer is signed in, so the document shows its
// Discussion; the test answers its message requests. No session exists, so
// nothing here reaches a real account. `EntityProvider` hands everything below
// it the app's query client, so that is the one that holds the identity.
if (PARAMS.has('discussion')) {
  queryClient.setQueryData(authKeys.userInfo.queryKey, {
    authenticated: true,
    id: 'macro|reader@example.com',
    permissions: [],
  } as unknown as UserInfoData);
}

function Providers(props: ParentProps) {
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={client}>
          <EntityProvider>
            <UserContextProvider>
              <TeamContextProvider>
                <EmailLinksContextProvider>
                  <ChannelsContextProvider>
                    <QuickAccessContextProvider value={QUICK_ACCESS}>
                      <DragDropProvider>{props.children}</DragDropProvider>
                    </QuickAccessContextProvider>
                  </ChannelsContextProvider>
                </EmailLinksContextProvider>
              </TeamContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

applyTheme(PARAMS.get('theme') === 'dark' ? 'Macro Dark' : 'Macro Light');
document.documentElement.dataset.touchDevice = String(isTouchDevice());

render(
  () => (
    <MemoryRouter root={Providers}>
      <Route path="*" component={Fixture} />
    </MemoryRouter>
  ),
  document.getElementById('root')!
);
