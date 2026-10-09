import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { DecoratorRenderer } from '@core/component/LexicalMarkdown/component/core/DecoratorRenderer';
import { DatabaseCard } from '@core/component/LexicalMarkdown/component/decorator/DatabaseCard';
import { DatabaseQuery } from '@core/component/LexicalMarkdown/component/decorator/DatabaseQuery';
import { DocumentMention } from '@core/component/LexicalMarkdown/component/decorator/DocumentMention';
import { ActionMenu } from '@core/component/LexicalMarkdown/component/menu/ActionsMenu';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { actionsPlugin } from '@core/component/LexicalMarkdown/plugins/actions/actionsPlugin';
import { blockDecoratorNavigationPlugin } from '@core/component/LexicalMarkdown/plugins/block-decorator-navigation';
import {
  INSERT_DOCUMENT_MENTION_COMMAND,
  mentionsPlugin,
} from '@core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin';
import { selectionDataPlugin } from '@core/component/LexicalMarkdown/plugins/selection-data/selectionDataPlugin';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import { UserContextProvider } from '@core/context/user';
import { registerRichText } from '@lexical/rich-text';
import {
  DatabaseQueryNode,
  DocumentCardNode,
  DocumentMentionNode,
  setDecorator,
} from '@macro-inc/lexical-core';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { contactsKeys } from '@queries/contacts/keys';
import { databasesKeys } from '@queries/storage/keys';
import { QueryClientProvider } from '@tanstack/solid-query';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { databaseId, documentDatabaseDetail } from './document-data';

setDecorator(DocumentCardNode, DatabaseCard);
setDecorator(DocumentMentionNode, DocumentMention);
setDecorator(DatabaseQueryNode, DatabaseQuery);
queryClient.setDefaultOptions({
  queries: { retry: false, staleTime: Infinity },
});
queryClient.setQueryData(
  databasesKeys.detail(databaseId).queryKey,
  documentDatabaseDetail()
);
queryClient.setQueryData(contactsKeys.all.queryKey, { contacts: [] });
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: 'macro|fixture@example.com',
  authenticated: true,
  permissions: [],
});

function DocumentFixture() {
  const wrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'database-document-fixture',
    isInteractable: () => true,
  });
  const editor = wrapper.editor;
  const menu = createMenuOperations();
  const [state, setState] = createSignal('');
  const [readOnly, setReadOnly] = createSignal(false);
  let root!: HTMLDivElement;
  wrapper.plugins.use(selectionDataPlugin(wrapper));
  wrapper.plugins.use(mentionsPlugin({ expandDatabaseMentions: true }));
  wrapper.plugins.use(actionsPlugin({ menu }));
  wrapper.plugins.use(blockDecoratorNavigationPlugin());
  const stopRichText = registerRichText(editor);
  const stopUpdate = editor.registerUpdateListener(({ editorState }) => {
    setState(JSON.stringify(editorState.toJSON()));
  });
  onCleanup(() => {
    stopRichText();
    stopUpdate();
    wrapper.cleanup();
  });
  onMount(() => {
    editor.setRootElement(root);
    editor.update(() => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Launch plan')),
        $createParagraphNode()
      );
      $getRoot().selectEnd();
    });
  });
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <main class="min-h-screen bg-page p-8 text-ink">
        <div class="mb-4 flex gap-3">
          <button
            onClick={() => {
              editor.focus(() =>
                editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
                  documentId: databaseId,
                  documentName: 'Launch tasks',
                  blockName: 'database',
                })
              );
            }}
          >
            Mention existing database
          </button>
          <button
            onClick={() => {
              setReadOnly(!readOnly());
              editor.setEditable(!readOnly());
            }}
          >
            Toggle document editing
          </button>
          <button
            onClick={() => {
              queryClient.setQueryData(
                databasesKeys.detail(databaseId).queryKey,
                { ...documentDatabaseDetail(), grant: 'view' }
              );
            }}
          >
            Database viewer
          </button>
        </div>
        <div class="relative mx-auto max-w-4xl">
          <div
            ref={root}
            contentEditable
            role="textbox"
            aria-label="Document"
            class="min-h-40 outline-none"
          />
          <DecoratorRenderer editor={editor} />
          <ActionMenu
            editor={editor}
            menu={menu}
            actionContext={{ disableMentionTracking: true }}
          />
        </div>
        <output aria-label="Document state" class="sr-only">
          {state()}
        </output>
      </main>
    </LexicalWrapperContext.Provider>
  );
}

render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <UserContextProvider>
            <DocumentFixture />
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  document.getElementById('root')!
);
