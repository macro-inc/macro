/** @vitest-environment jsdom */

import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { restoreFocusPlugin } from '@core/component/LexicalMarkdown/plugins/restore-focus';
import { selectionDataPlugin } from '@core/component/LexicalMarkdown/plugins/selection-data/selectionDataPlugin';
import { registerRichText } from '@lexical/rich-text';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Toolbar } from '@ui';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from 'lexical';
import {
  createRoot,
  createSignal,
  getOwner,
  runWithOwner,
  Show,
} from 'solid-js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as native from '../../../../lib/core/document-session/wasm/document_session_wasm.js';
import { MarkdownDocumentProvider } from '../../context/markdown-document-context';
import { createMarkdownDocumentState } from '../../context/markdown-document-state';
import { desktopBodyFormatPopup } from '../../views/body-format-popup';
import { FormatTools } from '../FormatTools';
import { createNativeDocumentFormattingObserver } from './native-observer';
import { select, state } from './native-test-fixture';

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function owned(
  run: (own: (release: () => unknown) => void) => Promise<void>
) {
  const releases: Array<() => unknown> = [];
  let failed = false;
  let primary: unknown;
  try {
    await run((release) => releases.push(release));
  } catch (error) {
    failed = true;
    primary = error;
  }
  for (const release of releases.reverse()) {
    try {
      await release();
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
  }
  if (failed) throw primary;
}

for (const engine of ['source', 'native'] as const) {
  for (const [label, tag] of [
    ['Heading 2', 'h2'],
    ['Numbered List', 'ol'],
  ] as const) {
    const guards =
      engine === 'native' && label === 'Heading 2'
        ? ([
            'normal',
            'revoke',
            'readonly',
            'dispose',
            'rebind',
            'unmount',
          ] as const)
        : (['normal'] as const);
    for (const guard of guards) {
      test(`${engine} block dropdown ${label} retains its body range after close (${guard})`, async () => {
        await owned(async (own) => {
          // jsdom defaults animationName to an empty string; solid-presence
          // requires the browser's explicit 'none' to finish menu unmounting.
          const styles = document.createElement('style');
          styles.textContent = '* { animation-name: none !important; }';
          own(() => styles.remove());
          document.head.append(styles);
          const body = document.createElement('div');
          own(() => body.remove());
          body.tabIndex = 0;
          body.contentEditable = 'true';
          body.setAttribute('contenteditable', 'true');
          document.body.append(body);
          const documentState = createRoot((dispose) => {
            own(dispose);
            return createMarkdownDocumentState();
          });
          const [canEdit, setCanEdit] = createSignal(true);
          const [showTools, setShowTools] = createSignal(true);
          const chronology: string[] = [];
          let renderOwner: ReturnType<typeof getOwner> = null;
          let transition = () => {};
          let unmountUI = () => {};
          let restore: (() => void) | undefined;
          let focusCount = () => 0;
          let callsAtTransition: number | undefined;
          let transitions = 0;
          let modelRange: () => { anchor: number; focus: number } | null = () =>
            null;
          const focus = (event: FocusEvent) =>
            chronology.push(
              event.target === body
                ? 'body'
                : event.target instanceof HTMLElement
                  ? event.target.tagName
                  : 'other'
            );
          document.addEventListener('focusin', focus);
          own(() => document.removeEventListener('focusin', focus));
          const context = {
            documentId: () => 'dropdown-focus',
            kind: () => 'document' as const,
            documentSource: () => ({ type: 'loading' as const }),
            permissions: {
              canEdit,
              canComment: () => false,
              isOwner: () => true,
            },
            persistedName: () => undefined,
            fallbackName: () => undefined,
            bodyFormatPopup: () => desktopBodyFormatPopup,
            state: documentState,
            element: () => body,
          };
          if (engine === 'source') {
            createRoot((dispose) => {
              own(dispose);
              const wrapper = createLexicalWrapper({
                type: 'markdown-sync',
                namespace: 'dropdown-source',
                withIds: true,
                isInteractable: canEdit,
              });
              own(() => wrapper.cleanup());
              const editor = wrapper.editor;
              modelRange = () =>
                editor.getEditorState().read(() => {
                  const selection = $getSelection();
                  return $isRangeSelection(selection)
                    ? {
                        anchor: selection.anchor.offset,
                        focus: selection.focus.offset,
                      }
                    : null;
                });
              own(
                editor.registerCommand(
                  FOCUS_COMMAND,
                  () => {
                    chronology.push('source-focus-command');
                    return false;
                  },
                  COMMAND_PRIORITY_LOW
                )
              );
              own(
                editor.registerUpdateListener(({ editorState, tags }) => {
                  const range = editorState.read(() => {
                    const selection = $getSelection();
                    return $isRangeSelection(selection)
                      ? {
                          anchor: selection.anchor.offset,
                          focus: selection.focus.offset,
                        }
                      : null;
                  });
                  chronology.push(
                    `source-commit:${JSON.stringify({ tags: [...tags], range, active: document.activeElement === body ? 'body' : document.activeElement?.tagName })}`
                  );
                })
              );
              const originalFocus = editor.focus.bind(editor);
              vi.spyOn(editor, 'focus').mockImplementation((...args) => {
                chronology.push('source-focus-call');
                originalFocus(...args);
              });
              own(() => editor.setRootElement(null));
              wrapper.plugins.use(selectionDataPlugin(wrapper));
              wrapper.plugins.use(restoreFocusPlugin());
              wrapper.plugins.list();
              own(registerRichText(editor));
              documentState.editor.setMd({
                editor,
                plugins: wrapper.plugins,
                mapping: wrapper.mapping,
                selection: wrapper.selection,
              });
              editor.setRootElement(body);
              const ui = render(() => {
                renderOwner = getOwner();
                return (
                  <MarkdownDocumentProvider context={context}>
                    <LexicalWrapperContext.Provider value={wrapper}>
                      <FloatingMenuGroup>
                        <Toolbar>
                          <Show when={showTools()}>
                            <FormatTools withinPopup />
                          </Show>
                        </Toolbar>
                      </FloatingMenuGroup>
                    </LexicalWrapperContext.Provider>
                  </MarkdownDocumentProvider>
                );
              });
              own(ui.unmount);
              unmountUI = () => setShowTools(false);
              editor.update(
                () => {
                  const text = $createTextNode('hello');
                  $getRoot()
                    .clear()
                    .append($createParagraphNode().append(text));
                  text.select(0, 5);
                },
                { discrete: true, tag: SKIP_SCROLL_INTO_VIEW_TAG }
              );
            });
          } else {
            createRoot((dispose) => {
              own(dispose);
              const formatting = createNativeDocumentFormattingObserver({
                canEdit,
                alive: () => true,
              });
              const [displayed, setDisplayed] = createSignal(formatting);
              const runtime = mountLocalSessionView(
                body,
                registerMacroElementViews(createBuiltinRegistry()),
                {
                  namespace: 'dropdown-native',
                  theme: {},
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
                  latestPublished: [formatting.observer],
                  create: (config, now, wall) =>
                    native.EditorSession.createMacroWithNamespace(
                      ABI_MAJOR,
                      config,
                      now,
                      wall,
                      'dropdown-native'
                    ),
                }
              );
              own(() => runtime.close());
              const focusCalls = vi.spyOn(runtime.view, 'focus');
              focusCount = () => focusCalls.mock.calls.length;
              if (guard === 'revoke') {
                transition = () => setCanEdit(false);
                restore = () => setCanEdit(true);
              } else if (guard === 'readonly') {
                transition = () => runtime.view.setEditable(false);
                restore = () => runtime.view.setEditable(true);
              } else if (guard === 'dispose') {
                transition = () => runtime.view.dispose();
              } else if (guard === 'rebind') {
                const otherRoot = document.createElement('div');
                own(() => otherRoot.remove());
                otherRoot.tabIndex = 0;
                document.body.append(otherRoot);
                const other = createNativeDocumentFormattingObserver({
                  canEdit,
                  alive: () => true,
                });
                const otherRuntime = mountLocalSessionView(
                  otherRoot,
                  registerMacroElementViews(createBuiltinRegistry()),
                  {
                    namespace: 'dropdown-other',
                    theme: {},
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
                    latestPublished: [other.observer],
                    create: (config, now, wall) =>
                      native.EditorSession.createMacroWithNamespace(
                        ABI_MAJOR,
                        config,
                        now,
                        wall,
                        'dropdown-other'
                      ),
                  }
                );
                own(() => otherRuntime.close());
                otherRuntime.port.setState(state('other'));
                select({ ...otherRuntime, root: otherRoot }, 'other');
                transition = () => setDisplayed(other);
              }
              modelRange = () => {
                const selection = runtime.view.selection().selection;
                return selection.kind === 'range'
                  ? {
                      anchor: selection.anchor.offset,
                      focus: selection.focus.offset,
                    }
                  : null;
              };
              const ui = render(() => {
                renderOwner = getOwner();
                return (
                  <MarkdownDocumentProvider context={context}>
                    <FloatingMenuGroup>
                      <Toolbar>
                        <Show when={displayed().controller()}>
                          {(controller) => (
                            <Show when={showTools()}>
                              <FormatTools
                                withinPopup
                                formattingHost={controller().host}
                                showLinkButton={false}
                              />
                            </Show>
                          )}
                        </Show>
                      </Toolbar>
                    </FloatingMenuGroup>
                  </MarkdownDocumentProvider>
                );
              });
              own(ui.unmount);
              unmountUI = () => setShowTools(false);
              runtime.port.setState(state('hello'));
              select({ ...runtime, root: body }, 'hello');
            });
          }
          body.blur();
          body.focus();
          await Promise.resolve();
          const trigger = screen.getByRole('button', {
            name: 'Body',
          });
          trigger.focus();
          fireEvent.keyDown(trigger, { key: 'ArrowDown' });
          const item = screen.getByRole('menuitemradio', {
            name: label,
          });
          item.focus();
          const menu = item.closest('[role=menu]');
          if (!menu) throw new Error('Missing actual Kobalte menu');
          if (guard === 'unmount') transition = () => unmountUI();
          if (guard !== 'normal') {
            trigger.addEventListener(
              'focusin',
              () => {
                transitions++;
                callsAtTransition = focusCount();
                transition();
              },
              { once: true }
            );
          }
          const closed = vi.fn();
          menu.addEventListener('focusScope.autoFocusOnUnmount', closed, {
            once: true,
          });
          if (!renderOwner) throw new Error('Missing actual live render owner');
          // The shared Dropdown lazily creates a memo while reading closeOnSelect.
          // Own that existing computation during the synthetic unit event; this
          // does not claim to repair production event ownership.
          runWithOwner(renderOwner, () =>
            fireEvent.keyDown(item, { key: 'Enter' })
          );
          await vi.runAllTimersAsync();
          expect(closed).toHaveBeenCalledOnce();
          expect(
            screen.queryByRole('menuitemradio', { name: label })
          ).toBeNull();
          expect(body.querySelector(tag)?.textContent).toBe('hello');
          expect(body.textContent).toBe('hello');

          expect(modelRange()).toEqual({ anchor: 0, focus: 5 });
          if (guard !== 'normal' && guard !== 'unmount') {
            expect(transitions).toBe(1);
            expect(focusCount()).toBe(callsAtTransition);
            expect(document.activeElement).not.toBe(body);
            if (restore) {
              restore();
              body.focus();
              const nextTrigger = screen.getByRole('button', {
                name: 'Heading 2',
              });
              nextTrigger.focus();
              fireEvent.keyDown(nextTrigger, { key: 'ArrowDown' });
              const paragraph = screen.getByRole('menuitemradio', {
                name: 'Body',
              });
              paragraph.focus();
              if (!renderOwner)
                throw new Error('Missing actual live render owner');
              runWithOwner(renderOwner, () =>
                fireEvent.keyDown(paragraph, { key: 'Enter' })
              );
              await vi.runAllTimersAsync();
              expect(body.querySelector('p')?.textContent).toBe('hello');
              expect(document.activeElement).toBe(body);
              const current = document.getSelection();
              expect(body.contains(current?.anchorNode ?? null)).toBe(true);
              expect(body.contains(current?.focusNode ?? null)).toBe(true);
              expect(current?.anchorOffset).toBe(0);
              expect(current?.focusOffset).toBe(5);
            }
            return;
          }
          if (guard === 'unmount') {
            // Use the still-live native host's current range. Source/native
            // toolbar-only unmount selection equivalence is a separate concern.
            expect(transitions).toBe(1);
            expect(body.isConnected).toBe(true);
            expect(
              screen.queryByRole('button', { name: 'Heading 2' })
            ).toBeNull();
          }
          const range = document.getSelection();
          expect(range?.anchorNode).toBeInstanceOf(Text);
          expect(range?.focusNode).toBeInstanceOf(Text);
          expect(body.contains(range?.anchorNode ?? null)).toBe(true);
          expect(body.contains(range?.focusNode ?? null)).toBe(true);
          expect(range?.anchorNode?.textContent).toBe('hello');
          expect(range?.focusNode?.textContent).toBe('hello');
          expect(range?.anchorOffset).toBe(0);
          expect(range?.focusOffset).toBe(5);
          if (engine === 'source') {
            // jsdom restores Source's DOM range but does not emulate browser
            // focus caused by changing a contenteditable DOM selection.
            expect(document.activeElement).toBe(trigger);
            const focusCall = chronology.lastIndexOf('source-focus-call');
            const triggerFocus = chronology.lastIndexOf('BUTTON');
            const commit = chronology.findLastIndex(
              (fact) =>
                fact.startsWith('source-commit:') && fact.includes('focus')
            );
            expect(focusCall).toBeGreaterThan(-1);
            expect(triggerFocus).toBeGreaterThan(focusCall);
            expect(commit).toBeGreaterThan(triggerFocus);
          } else {
            expect(document.activeElement, JSON.stringify(chronology)).toBe(
              body
            );
          }
        });
      });
    }
  }
}
