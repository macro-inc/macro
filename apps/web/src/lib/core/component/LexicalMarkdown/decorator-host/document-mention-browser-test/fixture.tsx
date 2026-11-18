import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { UserContextProvider } from '@core/context/user';
import { $dfs } from '@lexical/utils';
import {
  $createDocumentCardNode,
  $createDocumentMentionNode,
  DocumentCardNode,
  DocumentMentionNode,
} from '@macro-inc/lexical-core';
import { $setId, idState } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { previewKeys } from '@queries/preview/keys';
import type { PreviewItem } from '@queries/preview/types';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $nodesOfType,
  $setSelection,
  $setState,
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
import {
  $getDocumentMetadata,
  documentMetadataPlugin,
} from '../../plugins/document-metadata/documentMetadataPlugin';
import { mentionsPlugin } from '../../plugins/mentions/mentionsPlugin';
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
import { theme } from '../../theme';
import { NativeReferenceFixture } from './native-fixture';
import { NavigationBoundary } from './navigation-boundary';
import { StaticHostBoundary } from './static-host-boundary';

initializeLexical();
const params = new URLSearchParams(location.search);
const kind = params.get('kind') ?? 'md';
const card = params.get('shape') === 'card';
const id = '00000000-0000-7000-8000-000000000071';
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|viewer@example.com',
  email: 'viewer@example.com',
  permissions: [],
});
queryClient.setQueryData(previewKeys.item(id).queryKey, {
  id,
  type: kind === 'routine' ? 'routine' : 'document',
  access: 'access',
  loading: false,
  name: 'Fixture Document',
  rawName: 'Fixture Document',
  fileType: 'md',
} satisfies PreviewItem);
interface Capture {
  model: string;
  dom: string;
}
declare global {
  interface Window {
    documentReferenceInitial?: string;
    documentReferencePhaseTrace?: { kind: string; stack: string }[];
    documentReferenceRootIdentity?: () => {
      initial: string;
      created: string;
      updated: string;
    };
    documentMentionFixture?: {
      capture(): Capture;
      select(): void;
      enter(): boolean;
      clear(): void;
      componentProps(): unknown;
    };
  }
}
function Fixture() {
  const boundary = params.get('boundary');
  if (boundary) return <StaticHostBoundary native={boundary === 'native'} />;
  if (params.get('engine') === 'native')
    return (
      <NativeReferenceFixture
        shape={card ? 'document-card' : 'document-mention'}
      />
    );
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'document-mention-fixture',
    withIds: true,
    theme,
    isInteractable: () => true,
  });
  wrapper.plugins
    .richText()
    .use(selectionDataPlugin(wrapper))
    .use(documentMetadataPlugin({}))
    .use(mentionsPlugin({ disableMentionTracking: true }));
  if (params.get('earlyClear') === '1') {
    const release = wrapper.editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        $setSelection(null);
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    );
    onCleanup(release);
  }
  let root: HTMLDivElement | undefined;
  onMount(() => {
    if (!root) throw new Error('Missing Source root');
    wrapper.editor.setRootElement(root);
    if (window.documentReferenceInitial) {
      wrapper.editor.read(() => $getDocumentMetadata());
      wrapper.editor.setEditorState(
        wrapper.editor.parseEditorState(window.documentReferenceInitial)
      );
    } else
      wrapper.editor.update(
        () => {
          const info = {
            documentId: id,
            documentName: 'Fixture Document',
            blockName: kind,
            mentionUuid: 'document-mention-fixture',
          };
          if (card) {
            $getRoot()
              .clear()
              .append(
                $createParagraphNode().append($createTextNode('Before ')),
                $createDocumentCardNode(info),
                $createParagraphNode().append($createTextNode(' after'))
              );
          } else {
            const paragraph = $createParagraphNode();
            paragraph.append(
              $createTextNode('Before '),
              $createDocumentMentionNode({ ...info, createdAt: 1 }),
              $createTextNode(' after')
            );
            $getRoot().clear().append(paragraph);
          }
          for (const [index, { node }] of $dfs().slice(1).entries())
            $setId(node, `document-mention-${index}`);
        },
        { discrete: true }
      );
    const admission = params.get('admission');
    if (admission) {
      const saved = wrapper.editor.getEditorState().toJSON();
      const children = wrapper.editor.read(() => {
        if (card) {
          const node = $nodesOfType(DocumentCardNode)[0];
          if (!node) throw new Error('Missing actual Source card');
          const previewData =
            admission === 'array'
              ? [1, 'opaque']
              : admission === 'extra'
                ? { opaque: { second: 2, first: 1 } }
                : null;
          return [{ ...node.exportJSON(), mentionUuid: null, previewData }];
        }
        const node = $nodesOfType(DocumentMentionNode)[0];
        const paragraph = $getRoot().getFirstChild();
        if (!node || !$isElementNode(paragraph))
          throw new Error('Missing actual Source mention paragraph');
        return [
          {
            ...paragraph.exportJSON(),
            children: [
              { ...node.exportJSON(), mentionUuid: null, channelType: null },
            ],
          },
        ];
      });
      wrapper.editor.setEditorState(
        wrapper.editor.parseEditorState(
          JSON.stringify({
            ...saved,
            root: { ...saved.root, children },
          })
        )
      );
    }
    window.documentReferenceRootIdentity = () => {
      const snapshot = () =>
        JSON.stringify(wrapper.editor.getEditorState().toJSON());
      const initial = snapshot();
      wrapper.editor.update(
        () => {
          $getRoot().append(
            $createParagraphNode().append($createTextNode('Identity control'))
          );
        },
        { discrete: true }
      );
      const created = snapshot();
      wrapper.editor.update(
        () => {
          const rootNode = $getRoot();
          const paragraph = rootNode.getLastChild();
          if (!$isElementNode(paragraph))
            throw new Error('Missing actual created paragraph');
          $setState(paragraph, idState, null);
          paragraph.setFormat('center');
          rootNode.setFormat('right');
        },
        { discrete: true }
      );
      return { initial, created, updated: snapshot() };
    };
    const element = root;
    window.documentMentionFixture = {
      capture: () => ({
        model: JSON.stringify(wrapper.editor.getEditorState().toJSON()),
        dom: element.innerHTML,
      }),
      select() {
        wrapper.editor.update(
          () => {
            const node = card
              ? $nodesOfType(DocumentCardNode)[0]
              : $nodesOfType(DocumentMentionNode)[0];
            if (!node) throw new Error('Missing Source mention');
            const selection = $createNodeSelection();
            selection.add(node.getKey());
            $setSelection(selection);
          },
          { discrete: true }
        );
      },
      componentProps: () =>
        wrapper.editor.read(() => {
          const node = card
            ? $nodesOfType(DocumentCardNode)[0]
            : $nodesOfType(DocumentMentionNode)[0];
          if (!node) throw new Error('Missing actual Source decorator');
          return node.exportComponentProps();
        }),
      enter: () => wrapper.editor.dispatchCommand(KEY_ENTER_COMMAND, null),
      clear() {
        wrapper.editor.update(() => $setSelection(null), { discrete: true });
      },
    };
  });
  onCleanup(() => {
    delete window.documentMentionFixture;
    delete window.documentReferenceRootIdentity;
    wrapper.editor.setRootElement(null);
    wrapper.cleanup();
  });
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <FloatingMenuGroup>
        <div
          ref={root}
          contentEditable
          role="textbox"
          aria-label="Document mention fixture"
          class="md w-[640px] min-h-40 p-4 outline-none"
        />
        <DecoratorRenderer editor={wrapper.editor} />
      </FloatingMenuGroup>
    </LexicalWrapperContext.Provider>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <UserContextProvider>
            <MemoryRouter>
              <Route
                path="*"
                component={() =>
                  params.get('navigation') === 'real' ? (
                    <NavigationBoundary>
                      <Fixture />
                    </NavigationBoundary>
                  ) : (
                    <Fixture />
                  )
                }
              />
            </MemoryRouter>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  root
);
