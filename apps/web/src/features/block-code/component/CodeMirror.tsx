import { indentWithTab, toggleComment } from '@codemirror/commands';
import {
  closeSearchPanel,
  openSearchPanel,
  search,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type Panel } from '@codemirror/view';
import { useBlockId } from '@core/block';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import {
  blockMetadataSignal,
  blockTextSignal,
  blockUserAccessSignal,
} from '@core/signal/load';
import { storageServiceClient } from '@service-storage/client';
import { debounce, throttle } from '@solid-primitives/scheduled';
import { basicSetup } from 'codemirror';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { loadLanguageFromExtensionWithFallback } from '../util/languageSupport';
import { CodeSearchPanel } from './CodeSearchPanel';
import { macroThemeExtension } from './cmTheme';

/**
 * Read-only viewers keep a caret and can select text: `EditorState.readOnly`
 * rejects edits (including replace) while leaving the content focusable, which
 * `EditorView.editable.of(false)` would not. `inputmode` keeps the on-screen
 * keyboard out of the way on touch devices, where there is nothing to type.
 */
function readOnlyExtension(readOnly: boolean): Extension {
  return readOnly
    ? [
        EditorState.readOnly.of(true),
        EditorView.contentAttributes.of({ inputmode: 'none' }),
      ]
    : [];
}

// put this in your extensions array
export function CodeMirror() {
  let containerRef!: HTMLDivElement;

  const blockText = blockTextSignal.get;
  const setBlockText = blockTextSignal.set;
  const blockUserAccess = blockUserAccessSignal.get;
  const blockMetadata = blockMetadataSignal.get;
  const blockId = useBlockId();

  const readOnly = createMemo(
    () => blockUserAccess() !== 'owner' && blockUserAccess() !== 'edit'
  );

  let latestText = blockText() ?? '';
  let saving = false;
  const saveNow = async () => {
    if (saving || readOnly() || !blockId) return;
    saving = true;
    try {
      await storageServiceClient.simpleSave({
        documentId: blockId,
        file: new Blob([latestText], { type: 'text/plain' }),
      });
    } finally {
      saving = false;
    }
  };

  const debouncedSave = debounce(saveNow, 500);
  const throttledSave = throttle(saveNow, 5_000);

  const readOnlyCompartment = new Compartment();
  const languageCompartment = new Compartment();

  const [languageExtension, setLanguageExtension] =
    createSignal<Extension | null>(null);
  let view: EditorView | undefined;

  // The find bar lives in CodeMirror's panel slot (so match highlighting keeps
  // working) but renders through Solid, into the host element the panel hands
  // us, so it can use the app's own controls.
  const [searchPanel, setSearchPanel] = createSignal<{
    host: HTMLElement;
    view: EditorView;
  }>();
  const [searchPanelState, setSearchPanelState] = createSignal<EditorState>();

  const createSearchPanel = (panelView: EditorView): Panel => {
    const host = document.createElement('div');
    setSearchPanelState(panelView.state);
    setSearchPanel({ host, view: panelView });

    return {
      dom: host,
      top: true,
      mount() {
        // Solid fills the host in as a side effect of the signal write above,
        // so wait a tick before reaching for the field.
        queueMicrotask(() => {
          const input = host.querySelector<HTMLInputElement>('[main-field]');
          input?.focus();
          input?.select();
        });
      },
      update(update) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.startState.readOnly !== update.state.readOnly ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(setSearchQuery))
          )
        ) {
          setSearchPanelState(update.state);
        }
      },
      destroy() {
        setSearchPanel(undefined);
      },
    };
  };

  const [attach, scope] = useHotkeyDOMScope('code-mirror-editor');

  registerHotkey({
    hotkey: 'cmd+/',
    hotkeyToken: TOKENS.code.toggleComment,
    description: 'Toggle comment',
    scopeId: scope,
    keyDownHandler: () => {
      if (view) {
        toggleComment(view);
        return true;
      }
      return false;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkey: 'cmd+f',
    hotkeyToken: TOKENS.code.find,
    description: 'Find in code',
    scopeId: scope,
    keyDownHandler: () => {
      if (!view) return false;
      openSearchPanel(view);
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkey: 'escape',
    hotkeyToken: TOKENS.code.escape,
    description: 'Escape code editor',
    scopeId: scope,
    keyDownHandler: () => {
      if (!view) return false;
      // Escape closes the find bar before it gives up focus on the editor.
      if (searchPanelOpen(view.state)) {
        closeSearchPanel(view);
        return true;
      }
      view.contentDOM.blur();
      return true;
    },
    runWithInputFocused: true,
  });

  onMount(() => {
    attach(containerRef);

    view = new EditorView({
      parent: containerRef,
      state: EditorState.create({
        doc: latestText,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          search({ top: true, createPanel: createSearchPanel }),
          readOnlyCompartment.of(readOnlyExtension(readOnly())),
          languageCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            latestText = update.state.doc.toString();
            setBlockText(latestText);
            debouncedSave();
            throttledSave();
          }),
          macroThemeExtension,
        ],
      }),
    });

    createEffect(async () => {
      const metadata = blockMetadata();
      if (metadata?.fileType) {
        const extension = await loadLanguageFromExtensionWithFallback(
          metadata.fileType
        );
        setLanguageExtension(extension);
      } else {
        // Default to JavaScript if no file type is available
        const { javascript } = await import('@codemirror/lang-javascript');
        setLanguageExtension(javascript({ jsx: true, typescript: true }));
      }
    });

    createEffect(() => {
      if (!view) return;
      const extension = languageExtension();
      view.dispatch({
        effects: languageCompartment.reconfigure(extension ? [extension] : []),
      });
    });

    let firstApply = true;
    createEffect(() => {
      const serverText = blockText();
      if (view && typeof serverText === 'string') {
        if (firstApply) {
          firstApply = false;
          const cur = view.state.doc.toString();
          if (serverText !== cur) {
            view.dispatch({
              changes: {
                from: 0,
                to: view.state.doc.length,
                insert: serverText,
              },
            });
            latestText = serverText; // keep our local cache in sync
          }
        }
      }
    });

    createEffect(() => {
      if (!view) return;
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(readOnlyExtension(readOnly())),
      });
    });
  });

  onCleanup(() => {
    view?.destroy();
  });

  return (
    <>
      <div
        // Full-frame mobile/tablet: the floating split chrome overlays the panel, so
        // the inset lives on the CodeMirror scroller — code rests below the
        // chrome but under-scrolls it.
        class="size-full overflow-auto touch:[&_.cm-scroller]:pt-(--mobile-content-inset-top) touch:[&_.cm-scroller]:pb-(--mobile-content-inset-bottom)"
        ref={containerRef}
      />
      <Show when={searchPanel()}>
        {(panel) => (
          <Portal mount={panel().host}>
            <CodeSearchPanel
              view={panel().view}
              state={searchPanelState() ?? panel().view.state}
            />
          </Portal>
        )}
      </Show>
    </>
  );
}
