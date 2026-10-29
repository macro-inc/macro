import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import type { BlockAlias, BlockName } from '@core/block';
import { UserContextProvider } from '@core/context/user';
import { onElementConnect } from '@core/util/onElementConnect';
import { ThrownResultError } from '@core/util/result';
import { $dfs } from '@lexical/utils';
import {
  $isDocumentMentionNode,
  DocumentMentionNode,
} from '@macro-inc/lexical-core';
import { setDecorator } from '@macro-inc/lexical-core/decoratorRegistry';
import { agentSessionKeys } from '@queries/agent-session/keys';
import { authKeys } from '@queries/auth/keys';
import type { UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { previewKeys } from '@queries/preview/keys';
import type { PreviewItem, PreviewItemNoAccess } from '@queries/preview/types';
import { databaseDetailQueryOptions } from '@queries/storage/databases';
import { formDetailQueryOptions } from '@queries/storage/forms';
import { systemSkillsQueryOptions } from '@queries/storage/system-skills';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { $createNodeSelection, $setSelection } from 'lexical';
import { For, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../../context/LexicalWrapperContext';
import { selectionDataPlugin } from '../../../plugins';
import { channelTheme } from '../../../theme';
import { setEditorStateFromMarkdown } from '../../../utils';
import { DecoratorRenderer } from '../../core/DecoratorRenderer';
import { StaticMarkdownContext } from '../../core/StaticMarkdown';
import { AgentSessionMention } from '../AgentSessionMention';
import { DocumentMention } from '../DocumentMention';

setDecorator(DocumentMentionNode, DocumentMention);

// The previews answer as the API does for an item deleted (or a meeting
// cancelled) since it was mentioned, or one the viewer can't open.
const mentions = [
  {
    label: 'Deleted event',
    id: '01a16d55-0000-7000-8000-000000000001',
    blockName: 'calendar',
    preview: { type: 'calendar_event', access: 'does_not_exist' },
  },
  {
    label: 'Deleted document',
    id: '01a16d55-0000-7000-8000-000000000002',
    blockName: 'md',
    preview: { type: 'document', access: 'does_not_exist' },
  },
  {
    label: 'Deleted channel',
    id: '01a16d55-0000-7000-8000-000000000003',
    blockName: 'channel',
    preview: { type: 'channel', access: 'does_not_exist' },
  },
  {
    label: 'Hidden event',
    id: '01a16d55-0000-7000-8000-000000000004',
    blockName: 'calendar',
    preview: { type: 'calendar_event', access: 'no_access' },
  },
  {
    label: 'Deleted database',
    id: '01a16d55-0000-7000-8000-000000000005',
    blockName: 'database',
    preview: { type: 'database', access: 'does_not_exist' },
  },
  {
    label: 'Hidden database',
    id: '01a16d55-0000-7000-8000-000000000006',
    blockName: 'database',
    preview: { type: 'database', access: 'no_access' },
  },
  {
    label: 'Deleted form',
    id: '01a16d55-0000-7000-8000-000000000007',
    blockName: 'form',
    preview: { type: 'form', access: 'does_not_exist' },
  },
  {
    label: 'Hidden form',
    id: '01a16d55-0000-7000-8000-000000000008',
    blockName: 'form',
    preview: { type: 'form', access: 'no_access' },
  },
  {
    label: 'Deleted skill',
    id: '01a16d55-0000-7000-8000-000000000009',
    blockName: 'skill',
    preview: { type: 'document', access: 'does_not_exist' },
  },
  {
    label: 'Deleted routine',
    id: '01a16d55-0000-7000-8000-00000000000a',
    blockName: 'routine',
    preview: { type: 'routine', access: 'does_not_exist' },
  },
  {
    label: 'Hidden routine',
    id: '01a16d55-0000-7000-8000-00000000000b',
    blockName: 'routine',
    preview: { type: 'routine', access: 'no_access' },
  },
  {
    label: 'Hidden channel',
    id: '01a16d55-0000-7000-8000-00000000000f',
    blockName: 'channel',
    preview: { type: 'channel', access: 'no_access' },
  },
] as const satisfies ReadonlyArray<{
  label: string;
  id: string;
  blockName: BlockName | BlockAlias;
  preview: Pick<PreviewItemNoAccess, 'type' | 'access'>;
}>;

const sessions = [
  {
    label: 'Deleted agent session',
    id: '01a16d55-0000-7000-8000-00000000000c',
    access: 'does_not_exist',
  },
  {
    label: 'Hidden agent session',
    id: '01a16d55-0000-7000-8000-00000000000d',
    access: 'no_access',
  },
] as const satisfies ReadonlyArray<{
  label: string;
  id: string;
  access: PreviewItemNoAccess['access'];
}>;

for (const mention of mentions) {
  queryClient.setQueryData(previewKeys.item(mention.id).queryKey, {
    id: mention.id,
    ...mention.preview,
    loading: false,
  } satisfies PreviewItem);
}
// Database and form chips read their own detail; a deleted one answers 404 and
// a hidden one 403.
for (const mention of mentions) {
  const queryKey =
    mention.blockName === 'database'
      ? databaseDetailQueryOptions(mention.id).queryKey
      : mention.blockName === 'form'
        ? formDetailQueryOptions(mention.id).queryKey
        : undefined;
  if (!queryKey) continue;
  queryClient.setQueryDefaults(queryKey, { retryOnMount: false });
  queryClient
    .getQueryCache()
    .build(queryClient, { queryKey })
    .setState({
      status: 'error',
      error: new ThrownResultError([
        mention.preview.access === 'does_not_exist'
          ? { code: 'NOT_FOUND', message: 'Not found' }
          : { code: 'FORBIDDEN', message: 'Forbidden' },
      ]),
      errorUpdatedAt: Date.now(),
      fetchStatus: 'idle',
    });
}
// A database that loaded, then failed to refetch for a reason other than
// being gone, keeps the chip it loaded.
const loadedDatabaseId = '01a16d55-0000-7000-8000-00000000000e';
{
  const { queryKey } = databaseDetailQueryOptions(loadedDatabaseId);
  queryClient.setQueryDefaults(queryKey, {
    retryOnMount: false,
    refetchOnMount: false,
  });
  queryClient
    .getQueryCache()
    .build(queryClient, { queryKey })
    .setState({
      status: 'error',
      data: { database: { id: loadedDatabaseId, name: 'Roadmap' } },
      dataUpdatedAt: Date.now(),
      error: new ThrownResultError([
        { code: 'NETWORK_ERROR', message: 'Failed to fetch' },
      ]),
      errorUpdatedAt: Date.now(),
      fetchStatus: 'idle',
    });
}
queryClient.setQueryData(systemSkillsQueryOptions().queryKey, []);
for (const session of sessions) {
  for (const graphql of [false, true]) {
    queryClient.setQueryData(
      agentSessionKeys.preview(session.id, graphql).queryKey,
      { access: session.access }
    );
  }
  queryClient.setQueryData(previewKeys.item(session.id).queryKey, {
    id: session.id,
    type: 'agent_session',
    access: session.access,
    loading: false,
  } satisfies PreviewItem);
}
// A signed-in viewer: the no-access card sends anyone else to sign in.
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  email: 'viewer@example.com',
} as UserInfoData);

declare global {
  interface Window {
    selectComposerMention?: () => void;
  }
}

/** An editable editor holding the deleted document's and hidden channel's chips. */
function Composer() {
  const wrapper = createLexicalWrapper({
    type: 'chat',
    namespace: 'unavailable-mention-composer',
    isInteractable: () => true,
  });
  wrapper.plugins.richText().use(selectionDataPlugin(wrapper));
  setEditorStateFromMarkdown(
    wrapper.editor,
    `Before <m-document-mention>${JSON.stringify({
      documentId: mentions[1].id,
      blockName: mentions[1].blockName,
      documentName: 'Planning',
    })}</m-document-mention> after <m-document-mention>${JSON.stringify({
      documentId: mentions[11].id,
      blockName: mentions[11].blockName,
      documentName: 'Planning',
    })}</m-document-mention> end`
  );
  // Selects the chip as a node, as arrowing onto it in a composer does.
  window.selectComposerMention = () =>
    wrapper.editor.update(() => {
      const mention = $dfs().find(({ node }) => $isDocumentMentionNode(node));
      if (!mention) return;
      const selection = $createNodeSelection();
      selection.add(mention.node.getKey());
      $setSelection(selection);
    });
  onCleanup(() => wrapper.cleanup());
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <div
        ref={(element) =>
          onElementConnect(element, () =>
            wrapper.editor.setRootElement(element)
          )
        }
        contentEditable
        role="textbox"
        aria-label="Composer"
        class="w-96 border border-edge-muted p-2 outline-none"
      />
      <DecoratorRenderer editor={wrapper.editor} />
    </LexicalWrapperContext.Provider>
  );
}

function Fixture() {
  return (
    <main class="p-4 text-ink bg-page space-y-2">
      <For each={mentions}>
        {(mention) => (
          <p>
            {mention.label}:{' '}
            <DocumentMention
              key={mention.id}
              theme={channelTheme}
              documentId={mention.id}
              documentName="Planning"
              blockName={mention.blockName}
              createdAt={Date.now() - 10 * 60 * 1000}
            />
          </p>
        )}
      </For>
      <p>
        Loaded database:{' '}
        <DocumentMention
          key={loadedDatabaseId}
          theme={channelTheme}
          documentId={loadedDatabaseId}
          documentName="Roadmap"
          blockName="database"
          createdAt={Date.now() - 10 * 60 * 1000}
        />
      </p>
      <For each={sessions}>
        {(session) => (
          <p>
            {session.label}:{' '}
            <AgentSessionMention
              key={session.id}
              theme={channelTheme}
              id={session.id}
              label="Planning"
            />
          </p>
        )}
      </For>
      <Composer />
    </main>
  );
}

render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <UserContextProvider>
            <StaticMarkdownContext theme={channelTheme}>
              <MemoryRouter>
                <Route path="*" component={Fixture} />
              </MemoryRouter>
            </StaticMarkdownContext>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  document.getElementById('root')!
);
