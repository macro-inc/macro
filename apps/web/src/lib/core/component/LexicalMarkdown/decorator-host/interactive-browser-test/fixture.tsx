import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { $dfs } from '@lexical/utils';
import { $createPasteNode, $createSnapshotNode } from '@macro-inc/lexical-core';
import { $setId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { previewKeys } from '@queries/preview/keys';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import { FloatingMenuGroup } from '../../context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { initializeLexical } from '../../init';
import { documentMetadataPlugin } from '../../plugins/document-metadata';
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
import { trailingParagraphPlugin } from '../../plugins/trailing-paragraph';
import { theme } from '../../theme';

initializeLexical();
const kind = new URLSearchParams(location.search).get('kind');
if (kind !== 'snapshot' && kind !== 'paste')
  throw new Error('Unknown interactive Source fixture');
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|viewer@example.com',
  email: 'viewer@example.com',
  permissions: [],
});
// This is a supplied preview cache boundary, not backend permission acceptance.
queryClient.setQueryData(previewKeys.item('interactive-document').queryKey, {
  id: 'interactive-document',
  type: 'document',
  access: 'no_access',
  loading: false,
});

declare global {
  interface Window {
    interactiveSourceFixture?: {
      capture(): { model: string; dom: string };
      select(): void;
      enterAfterPendingRange(): {
        handled: boolean;
        publishedNodeDuringEarlier: boolean;
        pendingRangeDuringEarlier: boolean;
        laterCalls: number;
      };
    };
  }
}

function SourceFixture() {
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'interactive-decorators',
    withIds: true,
    isInteractable: () => true,
    theme,
  });
  wrapper.plugins
    .richText()
    .use(selectionDataPlugin(wrapper))
    .use(trailingParagraphPlugin())
    .use(documentMetadataPlugin({}));
  let root!: HTMLDivElement;
  let key: string;
  let mutateOnEnter = false;
  let publishedNodeDuringEarlier = false;
  let pendingRangeDuringEarlier = false;
  onMount(() => {
    const releaseEarlier = wrapper.editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        if (!mutateOnEnter) return false;
        $getRoot().getFirstChildOrThrow().selectStart();
        const published = wrapper.selection;
        publishedNodeDuringEarlier =
          published?.type === 'node' && published.nodeKeys.has(key);
        pendingRangeDuringEarlier = $isRangeSelection($getSelection());
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    );
    onCleanup(releaseEarlier);
    wrapper.editor.setRootElement(root);
    wrapper.editor.update(
      () => {
        const decorator =
          kind === 'snapshot'
            ? $createSnapshotNode({
                documentId: 'interactive-document',
                documentName: 'Snapshot fixture',
                blockName: 'md',
                content: 'Saved snapshot text',
                snapshotDate: '2020-01-01T00:00:00.000Z',
                mentionUuid: 'interactive-snapshot',
              })
            : $createPasteNode({
                content: '**Held** paste text',
                origin: 'pasted',
              });
        key = decorator.getKey();
        $getRoot().append(
          kind === 'snapshot'
            ? $createParagraphNode().append(decorator)
            : decorator,
          $createParagraphNode().append($createTextNode('Footer'))
        );
        for (const [index, { node }] of $dfs().entries())
          $setId(node, `interactive-node-${index}`);
      },
      { discrete: true }
    );
    window.interactiveSourceFixture = {
      capture: () => ({
        model: JSON.stringify(wrapper.editor.getEditorState().toJSON()),
        dom: root.innerHTML,
      }),
      select() {
        wrapper.editor.update(
          () => {
            const selection = $createNodeSelection();
            selection.add(key);
            $setSelection(selection);
          },
          { discrete: true }
        );
      },
      enterAfterPendingRange() {
        let laterCalls = 0;
        const releaseLater = wrapper.editor.registerCommand(
          KEY_ENTER_COMMAND,
          () => {
            laterCalls += 1;
            return false;
          },
          COMMAND_PRIORITY_NORMAL
        );
        mutateOnEnter = true;
        try {
          return {
            handled: wrapper.editor.dispatchCommand(KEY_ENTER_COMMAND, null),
            publishedNodeDuringEarlier,
            pendingRangeDuringEarlier,
            laterCalls,
          };
        } finally {
          mutateOnEnter = false;
          releaseLater();
        }
      },
    };
  });
  onCleanup(() => {
    delete window.interactiveSourceFixture;
    wrapper.editor.setRootElement(null);
    wrapper.cleanup();
  });
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <FloatingMenuGroup>
        <div
          ref={root}
          role="textbox"
          aria-label="Interactive decorators"
          contentEditable
          class="md w-[640px] min-h-80 p-4 outline-none"
        />
        <DecoratorRenderer editor={wrapper.editor} />
      </FloatingMenuGroup>
    </LexicalWrapperContext.Provider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing Source fixture root');
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <UserContextProvider>
            <EmailLinksContextProvider>
              <MobileSettingsProvider>
                <MemoryRouter>
                  <Route path="*" component={SourceFixture} />
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
