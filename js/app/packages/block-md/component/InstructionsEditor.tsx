import { markdownBlockErrorSignal } from '@block-md/signal/error';
import { revisionsSignal, rewriteSignal } from '@block-md/signal/rewriteSignal';
import { useBlockId } from '@core/block';
import type { LoroManager } from '@core/collab/manager';
import { DecoratorRenderer } from '@core/component/LexicalMarkdown/component/core/DecoratorRenderer';
import { FocusClickTarget } from '@core/component/LexicalMarkdown/component/core/FocusClickTarget';
import { LexicalStateDebugger } from '@core/component/LexicalMarkdown/component/debug/LexicalStateDebugger';
import { EmojiMenu } from '@core/component/LexicalMarkdown/component/menu/EmojiMenu';
import { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu';
import { SnippetsMenu } from '@core/component/LexicalMarkdown/component/menu/SnippetsMenu';
import {
  getErrorDescription,
  MarkdownEditorErrors,
} from '@core/component/LexicalMarkdown/constants';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  awaitPlugin,
  CLOSE_INLINE_SEARCH_COMMAND,
  DefaultShortcuts,
  documentMetadataPlugin,
  keyboardShortcutsPlugin,
  markdownPastePlugin,
  mentionsPlugin,
  textPastePlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { emojisPlugin } from '@core/component/LexicalMarkdown/plugins/emojis/emojisPlugin';
import { snippetsPlugin } from '@core/component/LexicalMarkdown/plugins/snippets';
import { useUserPromptPlugin } from '@core/component/LexicalMarkdown/plugins/userPrompt';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  editorFocusSignal,
  editorIsEmpty,
  getSaveState,
  initializeEditorEmpty,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '@core/component/LexicalMarkdown/utils';
import { ENABLE_MARKDOWN_LIVE_COLLABORATION } from '@core/constant/featureFlags';
import { blockElementSignal } from '@core/signal/blockElement';
import {
  blockFileSignal,
  blockHandleSignal,
  blockSourceSignal,
} from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
import { isSourceDSS, isSourceSyncService } from '@core/util/source';
import { bufToString } from '@core/util/string';
import {
  AwaitNode,
  CommentNode,
  createPeerIdValidator,
  InlineSearchNode,
  type PeerIdValidator,
  peerIdPlugin,
} from '@lexical-core';
import WarningIcon from '@phosphor/warning.svg';
import { onElementConnect } from '@solid-primitives/lifecycle';
import { debounce } from '@solid-primitives/scheduled';
import { createMethodRegistration } from 'core/orchestrator';
import type { EditorState } from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { blockDataSignal, mdStore } from '../signal/markdownBlockData';
import type { MarkdownRewriteOutput } from '../signal/rewriteSignal';
import { useBlockSave, useSaveMarkdownDocument } from '../signal/save';
import { MarkdownCollabProvider } from './MarkdownCollabProvider';

const DEBUG = false;
const EDITOR_PADDING_BOTTOM = 120;

export function InstructionsEditor(props: { loroManager: LoroManager }) {
  const blockData = blockDataSignal.get;
  const blockId = useBlockId();

  const saveMarkdownDocument = useSaveMarkdownDocument();
  const setMdStore = mdStore.set;
  const canEdit = useCanEdit();
  const [blockElement] = blockElementSignal;
  const docSource = blockSourceSignal.get;

  const blockHandle = blockHandleSignal.get;
  createMethodRegistration(blockHandle, {
    goToLocationFromParams: (_params: Record<string, any>) => {},
  });

  const IS_SYNC = () => {
    return docSource() && isSourceSyncService(docSource()!);
  };

  const debouncedSaveState = debounce(() => {
    const state_ = state();
    if (!state_ || !canEdit()) return;
    const savableState = getSaveState(editor.getEditorState());
    saveMarkdownDocument(JSON.stringify(savableState));
  }, 500);

  // flush save state after unblocking
  const blockSave = useBlockSave();
  createEffect((prev) => {
    const blockSave_ = blockSave();
    // no save on load
    if (!blockSave_ && prev !== undefined) {
      debouncedSaveState();
    }

    return blockSave_;
  }, undefined);

  let editorContainerRef!: HTMLDivElement;

  const [clickTargetHeight, setClickTargetHeight] = createSignal(0);

  const [editorReady, setEditorReady] = createSignal<boolean>(false);
  const [editorError, setEditorError] = markdownBlockErrorSignal;

  createEffect(() => {
    // We still want the editor to be locked down (for certain things like click events on check
    // lists) when the user does not have editor access.
    editor.setEditable(canEdit());
  });

  const isContentEditable = createMemo(() => {
    return (canEdit() ?? false) && !editorError();
  });

  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'block-md-instructions',
    isInteractable: isContentEditable,
    withIds: true,
  });

  const { editor, plugins, cleanup: cleanupPlugins } = lexicalWrapper;

  let [state, setState] = createSignal<EditorState>(editor.getEditorState());

  setMdStore('editor', editor);
  setMdStore('plugins', plugins);
  const [editorFocus, setEditorFocus] = createSignal(false);
  editorFocusSignal(editor, setEditorFocus);

  const mentionsMenuOperations = createMenuOperations();
  const emojiMenuOperations = createMenuOperations();
  const snippetsMenuOperations = createMenuOperations();

  const peerIdValidator: Accessor<PeerIdValidator> = () => {
    if (!IS_SYNC()) {
      return createPeerIdValidator(() => undefined, false);
    }
    const peerId = () => props.loroManager.getPeerIdStr();
    return createPeerIdValidator(peerId, true);
  };

  const userPromptPlugin = useUserPromptPlugin({
    documentId: blockId,
  });

  // plugins
  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<EditorState>(setState, 'json')
    .history(400, props.loroManager)
    .use(userPromptPlugin)
    .use(
      emojisPlugin({
        menu: emojiMenuOperations,
        peerIdValidator: peerIdValidator(),
      })
    )
    .use(
      mentionsPlugin({
        menu: mentionsMenuOperations,
        peerIdValidator: peerIdValidator(),
        sourceDocumentId: blockId,
        disableMentionTracking: true,
      })
    )
    .use(
      snippetsPlugin({
        menu: snippetsMenuOperations,
        peerIdValidator: peerIdValidator(),
        sourceDocumentId: blockId,
      })
    )
    .use(textPastePlugin())
    .use(markdownPastePlugin())
    .use(awaitPlugin())
    .use(
      keyboardShortcutsPlugin({
        shortcuts: DefaultShortcuts,
      })
    )
    .use(
      documentMetadataPlugin({
        onVersionError: (error) => setEditorError(error),
      })
    );

  if (ENABLE_MARKDOWN_LIVE_COLLABORATION) {
    const peerId = () => props.loroManager.getPeerIdStr();
    plugins.use(
      peerIdPlugin({
        peerId,
        nodes: [InlineSearchNode, CommentNode, AwaitNode],
      })
    );
  }

  const onConnect = (el: HTMLDivElement) => {
    setMdStore('selection', lexicalWrapper.selection);
    editor.setRootElement(el);

    // watch the height of the content editable to set the height of
    // the focus target
    const editorRefObserver = new ResizeObserver(() => {
      const blockEl = blockElement();
      if (!blockEl) {
        setClickTargetHeight(EDITOR_PADDING_BOTTOM);
        return;
      }
      const blockBottom =
        blockEl?.getBoundingClientRect().bottom ?? window.innerHeight;

      const targetHeight = blockBottom - el.getBoundingClientRect().bottom - 40;
      setClickTargetHeight(Math.max(targetHeight, EDITOR_PADDING_BOTTOM));
    });

    editorRefObserver.observe(el);
    onCleanup(() => {
      editorRefObserver.disconnect();
    });
  };

  const additionalCleanups: Array<() => void> = [];

  onCleanup(() => {
    additionalCleanups.forEach((cleanup) => cleanup());
    cleanupPlugins();
  });

  createEffect(() => {
    // We still want the editor to be locked down (for certain things like click events on check
    // lists) when the user does not have editor access.
    editor.setEditable(canEdit() ?? false);
  });

  const [editorHasNoContent, setEditorHasNoContent] = createSignal(false);

  const isBlankMarkdown = createMemo(() => {
    return editorHasNoContent();
  });

  // not all changes that can trigger preview display are text content changes.
  additionalCleanups.push(
    editor.registerUpdateListener(({ editorState }) => {
      setEditorHasNoContent(editorIsEmpty(editorState));
    })
  );

  // handle changes to the editor after initial load
  const registerSaveListener = () => {
    additionalCleanups.push(
      editor.registerUpdateListener(({ mutatedNodes }) => {
        if (mutatedNodes === null || mutatedNodes.size === 0) return;
        debouncedSaveState();
      })
    );
  };

  const [fileArrayBuffer, setFileArrayBuffer] = createSignal<ArrayBuffer>();
  createEffect(() => {
    const file = blockFileSignal();
    if (!file) return;

    file.arrayBuffer().then(setFileArrayBuffer);
  });

  createEffect(() => {
    const source = docSource();
    if (!source) return;
    if (!isSourceDSS(source)) return;
    if (!blockData()) return;
    if (editorReady()) return;

    const buf = fileArrayBuffer();
    if (!buf) return;
    const text = bufToString(buf);

    // Blank state is a new document.
    if (text === '') {
      setEditorHasNoContent(true);
      initializeEditorEmpty(editor);

      registerSaveListener();
      return;
    }

    // Valid JSON state is an existing document.
    let validJson = true;
    try {
      const parsed = JSON.parse(text);
      initializeEditorWithState(editor, parsed);

      // don't open any hanging inline searches.
      editor.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);

      if (editorIsEmpty(editor.getEditorState())) {
        setEditorHasNoContent(true);
      }

      registerSaveListener();
      setEditorReady(true);
      return;
    } catch (e) {
      console.error('LexicalParseError : ', e);
      validJson = false;
    }

    // Fallback is treated as a markdown string.
    if (!validJson) {
      setEditorStateFromMarkdown(editor, text);
      if (editorIsEmpty(editor.getEditorState())) {
        setEditorHasNoContent(true);
      }

      // Fallback is treated as a markdown string.
      if (!validJson) {
        setEditorStateFromMarkdown(editor, text);
        registerSaveListener();
      }

      if (editorIsEmpty(editor)) {
        setEditorError(MarkdownEditorErrors.EMPTY_SOURCE);
      }
    }

    setEditorReady(true);
  });

  const setRewriteSignal = rewriteSignal.set;
  const setRevisionSignal = revisionsSignal.set;

  createMethodRegistration(blockHandle, {
    setPatches: (args: { patches: MarkdownRewriteOutput['diffs'] }) => {
      setRewriteSignal(false);
      setRevisionSignal(args.patches);
    },
  });

  createMethodRegistration(blockHandle, {
    setIsRewriting: () => {
      setRewriteSignal(true);
    },
  });

  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      {/* SCUFFED: are these the right transparency values? */}
      <Show when={editorError()}>
        {(error) => (
          <div class="pointer-events-none text-alert-ink p-2 bg-alert-bg w-full border-alert/30 border mb-2 flex items-center gap-2">
            <WarningIcon class="size-6 shrink-0" />
            {getErrorDescription(error())}
          </div>
        )}
      </Show>
      <div class="relative" ref={editorContainerRef}>
        <div
          ref={(el) => {
            onElementConnect(el, () => {
              onConnect(el);
            });
          }}
          contentEditable={isContentEditable()}
          class="w-full max-w-full"
          classList={{
            'select-auto': !canEdit(),
            'md-no-comments': true,
          }}
        />

        <Show when={IS_SYNC()}>
          <MarkdownCollabProvider
            editor={editor}
            pluginManager={plugins}
            editorContainerRef={editorContainerRef}
            highlighLayerRef={editorContainerRef}
            mappings={lexicalWrapper.mapping!}
            editorFocus={editorFocus}
            setEditorReady={setEditorReady}
            setEditorError={setEditorError}
            loroManager={props.loroManager}
          />
        </Show>

        <FocusClickTarget
          editor={editor}
          editorFocus={editorFocus}
          style={{ height: `${clickTargetHeight()}px` }}
        />
        <Show when={isBlankMarkdown()}>
          <div class="pointer-events-none text-ink-placeholder absolute top-0">
            {canEdit()
              ? `Enter custom instructions for AI here...`
              : `This document is blank...`}
          </div>
        </Show>

        <DecoratorRenderer editor={editor} />

        <EmojiMenu
          editor={editor}
          menu={emojiMenuOperations}
          useBlockBoundary={true}
        />

        <MentionsMenu
          editor={editor}
          menu={mentionsMenuOperations}
          useBlockBoundary={true}
          disableMentionTracking={true}
        />

        <SnippetsMenu
          editor={editor}
          menu={snippetsMenuOperations}
          useBlockBoundary={true}
          sourceDocumentId={blockId}
        />

        <Show when={DEBUG}>
          <Show when={state()}>
            {(state) => (
              <LexicalStateDebugger state={state()}></LexicalStateDebugger>
            )}
          </Show>
        </Show>
      </div>
    </LexicalWrapperContext.Provider>
  );
}
