// C-TOUCH-CARET-MODE-01 part B, native engine: the product body overlay
// (createNativeBodyFormattingOverlay with its touch options) and the document's
// native comment host over the shared caret seed, with the product
// HorizontalRule decorator view.
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import type { ThreadId } from '@core/comments/commentType';
import { createNativeHorizontalRuleViews } from '@core/component/LexicalMarkdown/decorator-host/native-horizontal-rule';
import { createNativeSelectionDecoratorContext } from '@core/component/LexicalMarkdown/decorator-host/native-selection-host';
import {
  createNativeComments,
  type NativeComments,
} from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-comments';
import { theme } from '@core/component/LexicalMarkdown/theme';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { fireAndForget } from '@core/util/fireAndForget';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  type EditorView,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { Point } from '@macro-inc/lexical-wasm-view/view/types';
import { Telemetry } from '@macro-inc/observability';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';
import * as native from '../../../../../lib/core/document-session/wasm/document_session_wasm.js';
import { MarkdownDocumentProvider } from '../../../context/markdown-document-context';
import { createMarkdownDocumentState } from '../../../context/markdown-document-state';
import { createNativeBodyFormattingOverlay } from '../native-overlay';
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
import { mobileBodyFormatPopup } from '../../../views/mobile/body-format-popup';

const composition = isTouchDevice()
  ? mobileBodyFormatPopup
  : desktopBodyFormatPopup;

await native.default();

function point(view: EditorView, value: Point): CaretPoint {
  const node = view.mirror.node(value.key);
  return {
    type: value.type,
    node: node?.type ?? 'missing',
    parent:
      node && node.parent !== null
        ? (view.mirror.node(node.parent)?.type ?? 'missing')
        : 'none',
    text: node?.kind === 'text' ? node.text : null,
    offset: value.offset,
  };
}

type Serialized = { type: string; text?: string; children?: Serialized[] };
const textOf = (node: Serialized): string =>
  node.text ?? (node.children ?? []).map(textOf).join('');
/** Each root child's text, or its type when it has none (the rule). */
function paragraphTexts(content: string) {
  const root: Serialized = JSON.parse(content).root;
  return (root.children ?? []).map((child) =>
    child.children ? textOf(child) : child.type
  );
}

function NativeCaretPage() {
  const state = createMarkdownDocumentState();
  const [activeThread, setActiveThread] = createSignal<ThreadId | null>(null);
  const [facts, setFacts] = createSignal('');
  let body: HTMLDivElement | undefined;
  let runtime: ReturnType<typeof mountLocalSessionView> | undefined;
  let comments: NativeComments | undefined;
  let closed = false;
  let commits = 0;
  let contentRevision = 0;
  let lastContent = '';
  const selectionContext = createNativeSelectionDecoratorContext(theme);
  // The product overlay with the same touch options RustMarkdownEditor passes.
  // The product host RustMarkdownEditor.tsx:195 mounts, with its option shapes (touch, aiEdit,
  // comment). Values follow the Source page: no comment capability (canComment false) and the
  // inline AI edit flag off (no PostHog flags in the fixture).
  const formatting = createNativeBodyFormattingOverlay({
    composition: () => composition,
    canEdit: () => !caretReadOnly,
    alive: () => !closed,
    aiEdit: {
      documentId: () => 'caret-component',
      view: () => runtime?.view,
      enabled: () => false,
      parentSpan: Telemetry.span('caret-native-ai-edit'),
    },
    comment: {
      canComment: () => false,
      insert: () => false,
    },
    touch: {
      documentId: () => 'caret-component',
      view: () => runtime?.view,
      comments: {
        highlighted: () => caretThreads,
        activate: (thread) => setActiveThread(thread),
        caretCommentIds: (selection) =>
          comments?.caretCommentIds(selection) ?? null,
      },
    },
  });
  onMount(() => {
    if (!body) throw new Error('Missing native caret root');
    runtime = mountLocalSessionView(
      body,
      registerMacroDecoratorViews(
        registerMacroElementViews(createBuiltinRegistry()),
        createNativeHorizontalRuleViews(selectionContext.bindView)
      ),
      {
        namespace: 'caret-native',
        theme,
        // Read-only mirrors real access: a non-editable view, as well as canEdit.
        editable: !caretReadOnly,
        preset: 'rich',
        onError(error) {
          throw error;
        },
      },
      {
        viewEngine: 1,
        viewOs: 0,
        nativeCommands: native,
        create: (config, now, wall) =>
          native.EditorSession.createMacroWithNamespace(
            ABI_MAJOR,
            config,
            now,
            wall,
            'caret-native'
          ),
        latestPublished: [
          formatting.observer,
          {
            published(view) {
              commits += 1;
              const content = view.query.serializedState();
              if (content !== lastContent) {
                contentRevision += 1;
                lastContent = content;
              }
              const current = view.selection().selection;
              const selection: CaretSelection =
                current.kind === 'range'
                  ? {
                      kind: 'range',
                      anchor: point(view, current.anchor),
                      focus: point(view, current.focus),
                    }
                  : current.kind === 'node'
                    ? {
                        kind: 'node',
                        nodes: current.keys.map(
                          (key) => view.mirror.node(key)?.type ?? 'missing'
                        ),
                      }
                    : { kind: current.kind };
              setFacts(
                JSON.stringify({
                  engine: 'native',
                  selection,
                  commits,
                  contentRevision,
                  generation: view.mirror.keyGeneration,
                  revision: view.documentRevision,
                  paragraphs: paragraphTexts(content),
                })
              );
            },
            unavailable(reason) {
              console.error('native caret page unavailable', reason);
            },
            retired() {},
          },
        ],
      }
    );
    runtime.port.setState(caretSeed);
    comments = createNativeComments(runtime.view);
    document.documentElement.dataset.ready = 'true';
  });
  onCleanup(() => {
    closed = true;
    comments?.dispose();
    selectionContext.dispose();
    formatting.dispose();
    if (runtime) fireAndForget(runtime.close(), 'caret-native-close');
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
                canEdit: () => !caretReadOnly,
                canComment: () => false,
                isOwner: () => true,
              },
              persistedName: () => undefined,
              fallbackName: () => undefined,
              bodyFormatPopup: () => composition,
              state,
              element: () => body,
            }}
          >
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
                  {String(activeThread() ?? '')}
                </output>
              </main>
              <Dynamic component={formatting.Overlay} />
            </div>
          </MarkdownDocumentProvider>
        </CaretUserProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

const app = document.getElementById('app');
if (!app) throw new Error('Missing native caret mount');
render(NativeCaretPage, app);
