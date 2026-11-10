import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider, useQuickAccess } from '@core/context/quickAccess';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import { filterQuickAccessItems } from '@core/context/quickAccess/entity-search';
import type {
  Bucket,
  EntityItem,
  ItemForBucket,
  ItemsForBuckets,
  QuickAccessList,
  QuickAccessListOptions,
} from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EntityProvider, type SnippetEntity } from '@entity';
import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import { queryClient } from '@queries/client';
import { snippetRawKeys } from '@queries/storage/keys';
import { QueryClientProvider } from '@tanstack/solid-query';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { onCleanup, type ParentProps } from 'solid-js';
import { render } from 'solid-js/web';
import { SnippetsMenu } from '../../component/menu/SnippetsMenu/SnippetsMenu';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { snippetsPlugin } from '../../plugins/snippets/snippetsPlugin';
import { createMenuOperations } from '../../shared/inlineMenu';

const ROWS: EntityItem<SnippetEntity>[] = [
  'fixture-snippet',
  'alternative-snippet',
  'target-document',
].map((id) => ({
  id,
  kind: 'entity',
  bucket: 'snippet',
  searchText:
    id === 'fixture-snippet'
      ? 'Reusable example'
      : id === 'alternative-snippet'
        ? 'Alternative template'
        : 'Current document',
  sortTimestamp: 0,
  timestamps: {},
  data: {
    type: 'document',
    id,
    name:
      id === 'fixture-snippet'
        ? 'Reusable example'
        : id === 'alternative-snippet'
          ? 'Alternative template'
          : 'Current document',
    ownerId: 'fixture-owner',
    fileType: 'md',
    subType: { type: 'snippet' },
  },
}));

const cachedSource = createEditor({
  nodes: SupportedNodeTypes,
  onError(error) {
    throw error;
  },
});
cachedSource.update(
  () => {
    $getRoot().append(
      $createParagraphNode().append(
        $createTextNode('Cached snippet').toggleFormat('bold')
      )
    );
  },
  { discrete: true }
);
queryClient.setQueryData(
  snippetRawKeys.document('fixture-snippet').queryKey,
  cachedSource.getEditorState().toJSON()
);

function SuppliedSnippetCatalog(props: ParentProps) {
  const base = useQuickAccess();
  function useList(): QuickAccessList;
  function useList<B extends Bucket>(
    ...buckets: [B]
  ): QuickAccessList<ItemForBucket<B>>;
  function useList<B extends Bucket[]>(
    ...buckets: B
  ): QuickAccessList<ItemsForBuckets<B>>;
  function useList<const B extends readonly Bucket[]>(
    options: QuickAccessListOptions<B>
  ): QuickAccessList<ItemForBucket<B[number]>>;
  function useList(
    ...args: Bucket[] | [QuickAccessListOptions]
  ): QuickAccessList {
    const first = args[0];
    const options = typeof first === 'object' ? first : undefined;
    const buckets =
      options?.buckets ??
      args.filter((bucket): bucket is Bucket => typeof bucket === 'string');
    const actual = options ? base.useList(options) : base.useList(...buckets);
    if (buckets.length && !buckets.includes('snippet')) return actual;
    const items = () =>
      filterQuickAccessItems(ROWS, options?.searchTerm?.() ?? '');
    return { ...actual, items, totalCount: () => items().length };
  }
  return (
    <QuickAccessContextProvider
      value={{
        ...base,
        useList,
        getById: (id) => ROWS.find((row) => row.id === id) ?? base.getById(id),
      }}
    >
      {props.children}
    </QuickAccessContextProvider>
  );
}

function element(id: string) {
  const target = document.getElementById(id);
  if (!target) throw new Error(`Missing Source snippet fixture element ${id}`);
  return target;
}

function Fixture() {
  useHotKeyRoot();
  const menu = createMenuOperations();
  const wrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'source-snippet-overlay-fixture',
    isInteractable: () => true,
  });
  wrapper.plugins
    .richText()
    .use(snippetsPlugin({ menu, sourceDocumentId: 'target-document' }));
  const root = element('body');
  root.contentEditable = 'true';
  wrapper.editor.setRootElement(root);
  const publish = () => {
    element('live-state').textContent = JSON.stringify(
      wrapper.editor.getEditorState().toJSON()
    );
  };
  onCleanup(wrapper.editor.registerUpdateListener(publish));
  wrapper.editor.update(
    () => $getRoot().append($createParagraphNode()).selectStart(),
    { discrete: true }
  );
  const save = () => {
    element('saved').textContent = JSON.stringify(
      wrapper.editor.getEditorState().toJSON()
    );
  };
  element('save').addEventListener('click', save);
  onCleanup(() => {
    element('save').removeEventListener('click', save);
    wrapper.cleanup();
    wrapper.editor.setRootElement(null);
  });
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <SnippetsMenu
        editor={wrapper.editor}
        menu={menu}
        sourceDocumentId="target-document"
        portalScope="global"
      />
    </LexicalWrapperContext.Provider>
  );
}

render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelsContextProvider>
                  <QuickAccessProvider>
                    <SuppliedSnippetCatalog>
                      <Fixture />
                    </SuppliedSnippetCatalog>
                  </QuickAccessProvider>
                </ChannelsContextProvider>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  element('menus')
);
document.documentElement.dataset.ready = 'true';
