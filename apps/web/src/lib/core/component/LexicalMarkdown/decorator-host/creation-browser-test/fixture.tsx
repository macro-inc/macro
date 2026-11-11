import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import { createRoutedSplitLayout } from '@components/app/split-layout/tests/fixtures';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { createBlockOrchestrator } from '@core/orchestrator';
import { CodeNode } from '@lexical/code-core';
import { $dfs } from '@lexical/utils';
import { $getId, $setId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  RootNode,
} from 'lexical';
import { onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { initializeLexical } from '../../init';
import { ACTIONS } from '../../plugins/actions/actions';
import { awaitPlugin } from '../../plugins/await/awaitPlugin';
import {
  $getDocumentMetadata,
  documentMetadataPlugin,
} from '../../plugins/document-metadata/documentMetadataPlugin';
import { mentionsPlugin } from '../../plugins/mentions/mentionsPlugin';
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
import { trailingParagraphPlugin } from '../../plugins/trailing-paragraph/trailingParagraphPlugin';
import { theme } from '../../theme';

initializeLexical();
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|viewer@example.com',
  email: 'viewer@example.com',
  permissions: [],
});
interface CreationCapture {
  model: string;
  dom: string;
  component: string | undefined;
}
declare global {
  interface Window {
    creationProofClose?: () => void;
    creationProof?: {
      open(kind: 'task' | 'document'): void;
      start(): void;
      fail(): void;
      succeed(): Promise<void>;
      capture(): CreationCapture;
      close(): void;
    };
  }
}

function Fixture() {
  if (CodeNode.getType() !== 'code')
    throw new Error('Missing Source code module');
  const manager = createRoutedSplitLayout(createBlockOrchestrator(), '/home');
  setGlobalSplitManager(manager);
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'creation-fixture',
    isInteractable: () => true,
    withIds: true,
    theme,
  });
  wrapper.plugins
    .richText()
    .use(awaitPlugin())
    .use(mentionsPlugin({}))
    .use(selectionDataPlugin(wrapper))
    .use(trailingParagraphPlugin())
    .use(documentMetadataPlugin({}));
  let nextId = 0;
  const stopIds = wrapper.editor.registerNodeTransform(RootNode, () => {
    for (const { node } of $dfs()) {
      if (!$getId(node)?.startsWith('creation-fixture-'))
        $setId(node, `creation-fixture-${nextId++}`);
    }
  });
  const params = () => {
    const content = manager.getActivePopovers().at(-1)?.content();
    if (content?.type !== 'component' || !content.params)
      throw new Error('Missing actual creation popover');
    return content.params;
  };
  let root: HTMLDivElement | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    delete window.creationProof;
    delete window.creationProofClose;
    try {
      manager.closeAllPopovers();
    } finally {
      try {
        setGlobalSplitManager(undefined);
      } finally {
        try {
          stopIds();
        } finally {
          try {
            wrapper.editor.setRootElement(null);
          } finally {
            wrapper.cleanup();
          }
        }
      }
    }
  };
  window.creationProofClose = close;
  onMount(() => {
    if (!root) throw new Error('Missing Source creation root');
    const element = root;
    wrapper.editor.setRootElement(element);
    wrapper.editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append($createTextNode('Source creation'))
          )
          .selectEnd();
        $getDocumentMetadata();
      },
      { discrete: true }
    );
    window.creationProof = {
      open(kind) {
        const action = ACTIONS.find((item) => item.id === kind);
        if (!action) throw new Error('Missing Source creation action');
        action.action(wrapper.editor, { disableMentionTracking: true });
      },
      start() {
        const fn = params().onCreateStart;
        if (typeof fn !== 'function')
          throw new Error('Missing Source start callback');
        fn({ title: 'Created fixture', content: '' });
      },
      fail() {
        const fn = params().onCreateFailure;
        if (typeof fn !== 'function')
          throw new Error('Missing Source failure callback');
        fn();
      },
      async succeed() {
        const fn = params().onSuccess;
        if (typeof fn !== 'function')
          throw new Error('Missing Source success callback');
        await fn({
          documentId: 'created-fixture',
          title: 'Created fixture',
          content: '',
        });
      },
      capture() {
        return {
          model: JSON.stringify(wrapper.editor.getEditorState().toJSON()),
          dom: element.outerHTML,
          component: manager.getActivePopovers().at(-1)?.content().id,
        };
      },
      close,
    };
  });
  onCleanup(close);
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <div
        ref={root}
        role="textbox"
        contentEditable
        class="md w-[640px] min-h-80 p-4 outline-none"
      />
      <DecoratorRenderer editor={wrapper.editor} />
    </LexicalWrapperContext.Provider>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing creation fixture host');
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <UserContextProvider>
            <EmailLinksContextProvider>
              <MobileSettingsProvider>
                <MemoryRouter>
                  <Route path="*" component={Fixture} />
                </MemoryRouter>
              </MobileSettingsProvider>
            </EmailLinksContextProvider>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  root
);
