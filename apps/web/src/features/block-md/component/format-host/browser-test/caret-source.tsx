// C-TOUCH-CARET-MODE-01 part B, Source engine: the real MarkdownPopup over the
// shared caret seed, its HorizontalRule decorator rendered as the app does.
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { DecoratorRenderer } from '@core/component/LexicalMarkdown/component/core/DecoratorRenderer';
import { HorizontalRule } from '@core/component/LexicalMarkdown/component/decorator/HorizontalRule';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerRichText } from '@lexical/rich-text';
import { HorizontalRuleNode } from '@macro-inc/lexical-core';
import { setDecorator } from '@macro-inc/lexical-core/decoratorRegistry';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  type PointType,
} from 'lexical';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { MarkdownDocumentProvider } from '../../../context/markdown-document-context';
import { createMarkdownDocumentState } from '../../../context/markdown-document-state';
import { MarkdownPopup } from '../../MarkdownPopup';
import {
  type CaretPoint,
  type CaretSelection,
  caretReadOnly,
  caretSeed,
  caretThreads,
} from './caret-seed';
import { CaretUserProvider } from './caret-user';
import '@app/index.css';
import { desktopBodyFormatPopup } from '../../../views/body-format-popup';

if (import.meta.env.VITE_ENABLE_RUST_EDITOR_MODEL !== 'false')
  throw new Error('The Source caret page requires the explicit OFF profile');

setDecorator(HorizontalRuleNode, HorizontalRule);

function point(value: PointType): CaretPoint {
  const node = $getNodeByKey(value.key);
  return {
    type: value.type,
    node: node?.getType() ?? 'missing',
    parent: node?.getParent()?.getType() ?? 'none',
    text: $isTextNode(node) ? node.getTextContent() : null,
    offset: value.offset,
  };
}

function SourceCaretPage() {
  const state = createMarkdownDocumentState();
  const canEdit = () => !caretReadOnly;
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'caret-source',
    withIds: true,
    isInteractable: canEdit,
  });
  const editor = wrapper.editor;
  state.setCommentState('highlightedCommentThreads', caretThreads);
  const [facts, setFacts] = createSignal('');
  let body: HTMLDivElement | undefined;
  let commits = 0;
  let contentRevision = 0;
  let lastContent = '';
  const cleanupRichText = registerRichText(editor);
  const cleanupHistory = registerHistory(
    editor,
    createEmptyHistoryState(),
    400
  );
  const cleanupUpdate = editor.registerUpdateListener(({ editorState }) => {
    commits += 1;
    const content = JSON.stringify(editorState.toJSON());
    if (content !== lastContent) {
      contentRevision += 1;
      lastContent = content;
    }
    const selection: CaretSelection = editorState.read(() => {
      const current = $getSelection();
      if ($isRangeSelection(current))
        return {
          kind: 'range',
          anchor: point(current.anchor),
          focus: point(current.focus),
        };
      if ($isNodeSelection(current))
        return {
          kind: 'node',
          nodes: current.getNodes().map((node) => node.getType()),
        };
      return { kind: current ? 'other' : 'none' };
    });
    const paragraphs = editorState.read(() =>
      $getRoot()
        .getChildren()
        .map((child) =>
          $isElementNode(child) ? child.getTextContent() : child.getType()
        )
    );
    setFacts(
      JSON.stringify({
        engine: 'source',
        selection,
        commits,
        contentRevision,
        paragraphs,
      })
    );
  });
  onMount(() => {
    if (!body) throw new Error('Missing Source caret root');
    editor.setRootElement(body);
    // Read-only mirrors real access: a non-editable editor, as well as canEdit.
    editor.setEditable(!caretReadOnly);
    editor.setEditorState(editor.parseEditorState(caretSeed));
    document.documentElement.dataset.ready = 'true';
  });
  onCleanup(() => {
    cleanupUpdate();
    cleanupHistory();
    cleanupRichText();
    wrapper.cleanup();
    editor.setRootElement(null);
  });
  const device = () =>
    JSON.stringify({
      coarse: matchMedia('(pointer: coarse)').matches,
      isTouchDevice: isTouchDevice(),
      isMobileWidth: isMobileWidth(),
      isMobile: isMobile(),
    });
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <CaretUserProvider>
          <MarkdownDocumentProvider
            context={{
              documentId: () => 'caret-component',
              kind: () => 'document',
              documentSource: () => ({ type: 'loading' }),
              permissions: {
                canEdit,
                canComment: () => false,
                isOwner: () => true,
              },
              persistedName: () => undefined,
              fallbackName: () => undefined,
              bodyFormatPopup: () => desktopBodyFormatPopup,
              state,
              element: () => body,
            }}
          >
            <LexicalWrapperContext.Provider value={wrapper}>
              <FloatingMenuGroup>
                <div class="portal-scope relative" data-block-content>
                  <main class="mx-auto max-w-4xl p-8">
                    <input id="outside" aria-label="Outside" />
                    <div
                      id="body"
                      ref={body}
                      role="textbox"
                      aria-label="Body"
                      contentEditable={!caretReadOnly}
                      class="md border border-edge p-4 my-8"
                    />
                    <output id="caret-facts" hidden>
                      {facts()}
                    </output>
                    <output id="caret-device" hidden>
                      {device()}
                    </output>
                    <output id="caret-thread" hidden>
                      {String(state.comments.activeCommentThread ?? '')}
                    </output>
                  </main>
                  <DecoratorRenderer editor={editor} />
                  <MarkdownPopup
                    highlightLayerRef={document.createElement('div')}
                    lexicalMapping={wrapper.mapping}
                  />
                </div>
              </FloatingMenuGroup>
            </LexicalWrapperContext.Provider>
          </MarkdownDocumentProvider>
        </CaretUserProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

const app = document.getElementById('app');
if (!app) throw new Error('Missing Source caret mount');
render(SourceCaretPage, app);
