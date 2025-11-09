import { indentWithTab, toggleComment } from '@codemirror/commands';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { useBlockId } from '@core/block';
import { TOKENS } from '@core/hotkey/tokens';
import {
  blockMetadataSignal,
  blockTextSignal,
  blockUserAccessSignal,
} from '@core/signal/load';
import { storageServiceClient } from '@service-storage/client';
import { debounce, throttle } from '@solid-primitives/scheduled';
import { basicSetup } from 'codemirror';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { loadLanguageFromExtensionWithFallback } from '../util/languageSupport';
import { macroThemeExtension } from './cmTheme';

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
  const editableCompartment = new Compartment();
  const languageCompartment = new Compartment();

  const [languageExtension, setLanguageExtension] =
    createSignal<Extension | null>(null);
  let view: EditorView | undefined;

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
    hotkey: 'escape',
    hotkeyToken: TOKENS.code.escape,
    description: 'Escape code editor',
    scopeId: scope,
    keyDownHandler: () => {
      if (view) {
        view.contentDOM.blur();
        return true;
      }
      return false;
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
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly())),
          editableCompartment.of(EditorView.editable.of(!readOnly())),
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
        effects: [
          readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly())),
          editableCompartment.reconfigure(EditorView.editable.of(!readOnly())),
        ],
      });
    });
  });

  onCleanup(() => {
    view?.destroy();
  });

  return <div class="size-full overflow-auto" ref={containerRef} />;
}
