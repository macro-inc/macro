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
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { debounce, throttle } from '@solid-primitives/scheduled';
import { basicSetup } from 'codemirror';
import {
  createEffect,
  createSignal,
  on,
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

async function loadCodeLanguage(fileType?: string | null): Promise<Extension> {
  if (fileType) {
    return loadLanguageFromExtensionWithFallback(fileType);
  }

  const { javascript } = await import('@codemirror/lang-javascript');
  return javascript({ jsx: true, typescript: true });
}

export type CodeMirrorProps = {
  text: string;
  fileType?: string | null;
  readOnly: boolean;
  onTextChange: (text: string) => void;
  onSave: (text: string) => Promise<void>;
};

export function CodeMirror(props: CodeMirrorProps) {
  let containerRef!: HTMLDivElement;

  let latestText = props.text;
  let lastSavedText = props.text;
  let saving = false;
  let saveQueued = false;

  const saveNow = async () => {
    if (props.readOnly || latestText === lastSavedText) return;
    if (saving) {
      saveQueued = true;
      return;
    }

    saving = true;
    const textToSave = latestText;
    try {
      await props.onSave(textToSave);
      lastSavedText = textToSave;
    } catch (error) {
      console.error('error saving code document', error);
    } finally {
      saving = false;
      if (saveQueued) {
        saveQueued = false;
        void saveNow();
      }
    }
  };

  const debouncedSave = debounce(saveNow, 500);
  const throttledSave = throttle(saveNow, 5_000);

  const readOnlyCompartment = new Compartment();
  const languageCompartment = new Compartment();

  const [languageExtension, setLanguageExtension] =
    createSignal<Extension | null>(null);
  let view: EditorView | undefined;
  let applyingExternalText = false;

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
          readOnlyCompartment.of(readOnlyExtension(props.readOnly)),
          languageCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || applyingExternalText) return;
            latestText = update.state.doc.toString();
            props.onTextChange(latestText);
            debouncedSave();
            throttledSave();
          }),
          macroThemeExtension,
        ],
      }),
    });

    let languageLoadId = 0;
    createEffect(
      on(
        () => props.fileType,
        async (fileType) => {
          const loadId = ++languageLoadId;
          const extension = await loadCodeLanguage(fileType);
          if (loadId === languageLoadId) setLanguageExtension(extension);
        }
      )
    );

    createEffect(() => {
      if (!view) return;
      const extension = languageExtension();
      view.dispatch({
        effects: languageCompartment.reconfigure(extension ? [extension] : []),
      });
    });

    createEffect(() => {
      const externalText = props.text;
      if (!view || externalText === latestText) return;

      latestText = externalText;
      lastSavedText = externalText;
      applyingExternalText = true;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: externalText,
        },
      });
      applyingExternalText = false;
    });

    createEffect(() => {
      if (!view) return;
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(
          readOnlyExtension(props.readOnly)
        ),
      });
    });
  });

  onCleanup(() => {
    debouncedSave.clear();
    throttledSave.clear();
    void saveNow();
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
