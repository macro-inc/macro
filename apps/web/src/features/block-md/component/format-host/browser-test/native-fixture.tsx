import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { HostedFloatingFormatMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingFormatMenu';
import { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { theme } from '@core/component/LexicalMarkdown/theme';
import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import { Toolbar } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import * as native from '../../../../../lib/core/document-session/wasm/document_session_wasm.js';
import { MarkdownDocumentProvider } from '../../../context/markdown-document-context';
import { createMarkdownDocumentState } from '../../../context/markdown-document-state';
import { FormatTools } from '../../FormatTools';
import { promptSlot } from '../body-popup-slots';
import { createNativeAiEditSlot } from '../native-ai-edit-slot';
import { NativeBodyFormatPopup } from '../native-body-popup';
import { createNativeDocumentFormattingObserver } from '../native-observer';
import { readNativeSelectionSnippet } from '../native-snippet';
import { createNativeBodyTouchActions } from '../native-touch-actions';
import '@app/index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { desktopBodyFormatPopup } from '../../../views/body-format-popup';
import { mobileBodyFormatPopup } from '../../../views/mobile/body-format-popup';

const composition = isTouchDevice()
  ? mobileBodyFormatPopup
  : desktopBodyFormatPopup;

await native.default();

function paragraph(text: string) {
  return {
    type: 'paragraph',
    version: 1,
    children: [{ type: 'text', version: 1, text }],
  };
}
function documentJSON(children: unknown[]) {
  return JSON.stringify({ root: { type: 'root', version: 1, children } });
}

function NativeFormattingFixture() {
  const state = createMarkdownDocumentState();
  const [canEdit, setCanEdit] = createSignal(true);
  const [saved, setSaved] = createSignal('');
  const [live, setLive] = createSignal('');
  const [selectionFacts, setSelectionFacts] = createSignal('');
  const floating = new URLSearchParams(location.search).has('floating');
  const bodyPopup = new URLSearchParams(location.search).has('body');
  // Source's AI edit selection action, as a fixture slot with Source's
  // prompt markup (MarkdownPopup.tsx:743-760).
  const withAi = new URLSearchParams(location.search).has('ai');
  let body: HTMLDivElement | undefined;
  let runtime: ReturnType<typeof mountLocalSessionView> | undefined;
  // The real AI slot's touch path (tap-time origin, drawer, highlight); the
  // desktop button and prompt below stay the fixture's.
  const realAi = createNativeAiEditSlot({
    documentId: () => 'formatting-component',
    view: () => runtime?.view,
    enabled: () => withAi,
    parentSpan: Telemetry.span('native-fixture-ai-edit'),
  });
  const aiSlots = withAi
    ? [
        promptSlot<string>({
          id: 'ai',
          available: () => true,
          button: (control) => (
            <button type="button" onClick={() => control.open()}>
              AI edit
            </button>
          ),
          capture: () => document.getSelection()?.toString() ?? '',
          select: realAi.slot.select,
          prompt: (control) => (
            <textarea
              aria-label="Describe changes"
              placeholder="Describe changes"
              data-captured={control.value}
              ref={(textarea) => requestAnimationFrame(() => textarea.focus())}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                control.dismiss();
              }}
            />
          ),
        }),
      ]
    : [];
  let closed = false;
  const canInteract = () =>
    canEdit() &&
    !state.generation.isGenerating() &&
    !state.generation.generatedAndWaiting() &&
    !state.editor.error();
  const formatting = createNativeDocumentFormattingObserver({
    canEdit: canInteract,
    alive: () => !closed,
    snippetLink: { documentId: () => 'formatting-component' },
  });
  // The product's touch actions: no comment capability, no threads.
  const touch = createNativeBodyTouchActions({
    documentId: () => 'formatting-component',
    view: () => runtime?.view,
    canEdit: canInteract,
    alive: () => !closed,
    comments: { highlighted: () => [], activate: () => {} },
    snippetLink: () => formatting.snippetLink(),
  });
  onMount(() => {
    if (!body) throw new Error('Missing actual native document root');
    runtime = mountLocalSessionView(
      body,
      registerMacroElementViews(createBuiltinRegistry()),
      {
        namespace: 'formatting-component',
        theme,
        editable: true,
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
            'formatting-component'
          ),
        latestPublished: [
          formatting.observer,
          {
            published(view) {
              setLive(view.query.serializedState());
              const facts = formatting.controller()?.host.selection();
              const info = view.selection();
              setSelectionFacts(
                JSON.stringify({
                  format: info.format,
                  hasLinks: facts?.hasLinks,
                  elementsInRange: [...(facts?.elementsInRange ?? [])],
                  // The native MODEL selection as published at this commit.
                  model: info.selection,
                  generation: view.mirror.keyGeneration,
                  selectedText: readNativeSelectionSnippet(view)?.text ?? null,
                })
              );
            },
            unavailable(reason) {
              console.error('native formatting unavailable', reason);
            },
            retired() {},
          },
        ],
      }
    );
    runtime.port.setState(documentJSON([paragraph('Select this phrase')]));
    // As a real open: the loaded document is not an undo step. The native
    // DocumentSession builds a fresh UndoManager after the initial projection
    // ("Initialization's ClearHistory boundary", document_session editor.rs
    // :350-363); this local session takes the editor's own boundary.
    runtime.port.command(CommandCode.ClearHistory);
    document.documentElement.dataset.ready = 'true';
  });
  onCleanup(() => {
    closed = true;
    if (runtime) runtime.close().catch(console.error);
  });
  const activeRuntime = () => {
    if (closed || !runtime)
      throw new Error('Native formatting fixture is closed');
    return runtime;
  };
  const loadFormatting = () =>
    activeRuntime().port.setState(
      documentJSON([
        paragraph('Plain'),
        {
          type: 'heading',
          version: 1,
          tag: 'h4',
          children: [{ type: 'text', version: 1, text: 'Four' }],
        },
        {
          type: 'paragraph',
          version: 1,
          children: [
            {
              type: 'link',
              version: 1,
              url: 'https://example.com',
              children: [{ type: 'text', version: 1, text: 'linked' }],
            },
          ],
        },
        {
          type: 'heading',
          version: 1,
          tag: 'h6',
          children: [{ type: 'text', version: 1, text: 'Six' }],
        },
      ])
    );
  const loadTable = () =>
    activeRuntime().port.setState(
      documentJSON([
        {
          type: 'table',
          version: 1,
          children: Array.from({ length: 3 }, (_, row) => ({
            type: 'tablerow',
            version: 1,
            children: Array.from({ length: 3 }, (_, column) => ({
              type: 'tablecell',
              version: 1,
              headerState: 0,
              colSpan: 1,
              rowSpan: 1,
              children: [paragraph(`Cell ${row * 3 + column + 1}`)],
            })),
          })),
        },
      ])
    );
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <MarkdownDocumentProvider
          context={{
            documentId: () => 'formatting-component',
            kind: () => 'document',
            documentSource: () => ({ type: 'loading' }),
            permissions: {
              canEdit,
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
          <FloatingMenuGroup>
            <div class="portal-scope relative" data-block-content>
              <main class="mx-auto max-w-4xl p-8">
                <Show when={!floating && !bodyPopup && formatting.controller()}>
                  {(controller) => (
                    <Toolbar aria-label="Document formatting">
                      <FormatTools
                        withinPopup
                        formattingHost={controller().host}
                      />
                    </Toolbar>
                  )}
                </Show>
                <div
                  id="body"
                  ref={body}
                  role="textbox"
                  aria-label="Body"
                  contentEditable={canEdit()}
                  class="md border border-edge p-4 my-8"
                />
                <button type="button" onClick={loadFormatting}>
                  Load formatting facts
                </button>
                <button type="button" onClick={loadTable}>
                  Load table
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setCanEdit(false);
                    activeRuntime().view.setEditable(false);
                  }}
                >
                  Read only
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSaved(activeRuntime().view.query.serializedState())
                  }
                >
                  Save state
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => state.generation.setIsGenerating(true)}
                >
                  Lock generation
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => state.generation.setGeneratedAndWaiting(true)}
                >
                  Lock waiting
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() =>
                    state.editor.setError(MarkdownEditorErrors.JSON_PARSE_ERROR)
                  }
                >
                  Lock error
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    state.generation.setIsGenerating(false);
                    state.generation.setGeneratedAndWaiting(false);
                    state.editor.setError(null);
                  }}
                >
                  Unlock formatting
                </button>
                <output id="selection-facts" hidden>
                  {selectionFacts()}
                </output>
                <output id="live-state" hidden>
                  {live()}
                </output>
                <output id="saved">{saved()}</output>
              </main>
              <Show when={floating && formatting.controller()}>
                {(controller) => (
                  <HostedFloatingFormatMenu
                    host={controller().menu}
                    options={{}}
                  />
                )}
              </Show>
              <Show when={bodyPopup && formatting.controller()}>
                {(controller) => (
                  <NativeBodyFormatPopup
                    composition={composition}
                    host={controller().host}
                    popup={controller().bodyPopup}
                    slots={aiSlots}
                    touch={touch}
                    onToolbarClosed={realAi.popupClosed}
                  />
                )}
              </Show>
              <Show when={bodyPopup && withAi}>
                {realAi.Highlight()}
                {realAi.Drawer()}
              </Show>
            </div>
          </FloatingMenuGroup>
        </MarkdownDocumentProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}
// ?caret: the C-TOUCH-CARET-MODE-01 native caret page, in its own module.
if (new URLSearchParams(location.search).has('caret')) {
  await import('./caret-native');
} else {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing native formatting fixture mount');
  render(NativeFormattingFixture, app);
}
