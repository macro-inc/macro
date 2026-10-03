import { CollabProvider } from '@core/component/LexicalMarkdown/collaboration/CollabProvider';
import {
  getErrorDescription,
  type MarkdownEditorErrors,
} from '@core/component/LexicalMarkdown/constants';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { useEditorEntityDrop } from '@core/component/LexicalMarkdown/editing/entityDrop';
import { MarkdownEditingOverlays } from '@core/component/LexicalMarkdown/editing/MarkdownEditingOverlays';
import {
  type MarkdownEditingSource,
  registerMarkdownEditing,
} from '@core/component/LexicalMarkdown/editing/registerMarkdownEditing';
import type { MentionLinkResolver } from '@core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin';
import {
  editorFocusSignal,
  editorIsEmpty,
  initializeEditorEmpty,
} from '@core/component/LexicalMarkdown/utils';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { createPeerIdValidator } from '@macro-inc/lexical-core';
import { onElementConnect } from '@solid-primitives/lifecycle';
import type { LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import type { CollabMarkdownSession } from './types';

/** Imperative handle for embedding surfaces in composer-style UIs. */
export type CollabMarkdownControls = {
  /** The current content, serialized to markdown. */
  getMarkdown: () => string;
  /**
   * Clear the surface for everyone. This is a normal collaborative edit: it
   * syncs through Loro, so every connected peer's surface empties.
   */
  clear: () => void;
  /** Focus the editor. */
  focus: () => void;
  /** The underlying Lexical editor, for registering commands (e.g. submit-on-enter). */
  getLexical: () => LexicalEditor;
  /**
   * Whether an inline menu (mentions, emoji, snippets) is open. Submit-on-enter
   * handlers must not fire while one is — Enter belongs to the menu.
   */
  isInlineMenuOpen: () => boolean;
};

export type CollabMarkdownEditorProps = {
  /** Stable identity of the document or collaborative surface. */
  sourceId: string;
  /** The block hosting the surface, for actions such as the slash task. */
  sourceBlockName?: string;
  /** Keep inline menus inside the hosting block. Defaults to true. */
  useBlockBoundary?: boolean;
  session: CollabMarkdownSession;
  /**
   * Whether the caller may edit. UI-only: the server enforces the real
   * permission via the connection token's access level, so a lying caller
   * merely gets its updates rejected. Defaults to editable.
   */
  canEdit?: Accessor<boolean>;
  /** Whether the caller may comment. Defaults to false. */
  canComment?: Accessor<boolean>;
  /** Lexical namespace, for devtools disambiguation. */
  namespace?: string;
  /** Class applied to the outer container. */
  class?: string;
  /** Accessible editor label. */
  label?: string;
  /** Placeholder shown while the surface is empty. */
  placeholder?: string;
  /** Called once the editor is live (initial state applied, engine running). */
  onReady?: () => void;
  /** Receives the imperative controls once, at mount. */
  onControls?: (controls: CollabMarkdownControls) => void;
  /** Called when the editor enters an error state. */
  onError?: (error: MarkdownEditorErrors) => void;
  /** Convert routed app URLs to document mentions on paste. */
  resolveAppLink?: MentionLinkResolver;
  /** Optional status UI rendered by the collab provider. */
  statusChrome?: JSX.Element;
};

false && fileFolderDrop;

/**
 * Collaborative markdown editor with the document editor's editing features,
 * over an explicitly owned session.
 */
export function CollabMarkdownEditor(props: CollabMarkdownEditorProps) {
  const canEdit = props.canEdit ?? (() => true);
  const canComment = props.canComment ?? (() => false);

  const session = props.session;

  const [editorReady, setEditorReady] = createSignal(false);
  const [editorError, setEditorError] =
    createSignal<MarkdownEditorErrors | null>(null);
  const [editorHasNoContent, setEditorHasNoContent] = createSignal(false);

  const isContentEditable = () =>
    canEdit() && editorReady() && !editorError() && !session.connectionError();

  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: props.namespace ?? 'collab-surface',
    isInteractable: isContentEditable,
    withIds: true,
  });
  const { editor, plugins, cleanup: cleanupPlugins } = lexicalWrapper;
  onCleanup(cleanupPlugins);

  const [editorFocus, setEditorFocus] = createSignal(false);
  editorFocusSignal(editor, setEditorFocus);

  // Markdown-serialized view of the editor state, for `controls.getMarkdown`.
  const [markdownState, setMarkdownState] = createSignal('');

  // Collab is the point of this component, so the validator is always live:
  // it keeps this peer from committing another peer's in-flight inline nodes
  // (mentions, emoji searches, snippets).
  const peerId = () => session.loroManager.peerIdStr;
  const peerIdValidator = createPeerIdValidator(peerId, true);

  // A surface is not a document, so its mentions are not tracked references.
  const editingSource: MarkdownEditingSource = {
    id: props.sourceId,
    blockName: props.sourceBlockName,
    trackMentions: false,
  };

  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<string>(setMarkdownState, 'markdown')
    .history(400, session.loroManager);
  const editing = registerMarkdownEditing({
    lexicalWrapper,
    isContentEditable,
    peerIdValidator,
    source: editingSource,
    resolveAppLink: props.resolveAppLink,
    onVersionError: (error) => setEditorError(error),
    peerId,
  });
  const droppable = useEditorEntityDrop({
    editor,
    canEdit,
    dragInsert: editing.dragInsert,
    source: editingSource,
  });
  false && droppable;

  createEffect(() => {
    editor.setEditable(isContentEditable());
  });

  props.onControls?.({
    getMarkdown: () => markdownState(),
    clear: () => initializeEditorEmpty(editor, peerId),
    focus: () => editor.focus(),
    getLexical: () => editor,
    isInlineMenuOpen: editing.isInlineMenuOpen,
  });

  createEffect(() => {
    if (editorReady()) props.onReady?.();
  });
  createEffect(() => {
    const error = editorError();
    if (error !== null) props.onError?.(error);
  });

  onCleanup(
    editor.registerUpdateListener(({ editorState }) => {
      setEditorHasNoContent(editorIsEmpty(editorState));
    })
  );

  let editorContainerRef!: HTMLDivElement;

  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      <div class={props.class ?? ''}>
        <Show when={editorError()}>
          {(error) => (
            <div class="pointer-events-none text-alert-ink p-2 bg-alert-bg w-full border-alert/30 border mb-2">
              {getErrorDescription(error())}
            </div>
          )}
        </Show>
        <Show when={session.connectionError()}>
          <div class="text-alert-ink p-2 bg-alert-bg w-full border-alert/30 border mb-2">
            Could not connect to the content.
          </div>
        </Show>
        <div
          class="relative"
          ref={editorContainerRef}
          use:fileFolderDrop={{
            disabled: !isContentEditable(),
            onDrop: (fileEntries, folderEntries, e) => {
              if (!e) return;
              editing.dropFiles(fileEntries, folderEntries, e);
            },
          }}
          use:droppable
        >
          <div
            ref={(el) => {
              onElementConnect(el, () => {
                editor.setRootElement(el);
                editing.connectContainer(editorContainerRef);
              });
            }}
            contentEditable={isContentEditable()}
            role="textbox"
            aria-label={props.label ?? 'Document content'}
            aria-multiline="true"
            aria-readonly={!canEdit()}
            class="ph-no-capture w-full max-w-full outline-none"
            classList={{
              'select-auto': !canEdit(),
              'md-no-comments': true,
            }}
          />

          <Show when={!editorReady()}>
            <div class="absolute inset-0 flex flex-col gap-2 pointer-events-none">
              <div class="h-4 w-2/3 animate-pulse rounded bg-ink/10" />
              <div class="h-4 w-1/2 animate-pulse rounded bg-ink/10" />
            </div>
          </Show>

          <Show when={editorReady() && editorHasNoContent()}>
            <div class="pointer-events-none text-ink-placeholder absolute top-0">
              {props.placeholder ?? 'Start typing…'}
            </div>
          </Show>

          {/* The provider's syncSource check is non-reactive, so mount it only
              once the session's socket exists. */}
          <Show when={session.syncSource()}>
            <CollabProvider
              editor={editor}
              pluginManager={plugins}
              editorContainerRef={editorContainerRef}
              highlightLayerRef={editorContainerRef}
              mappings={lexicalWrapper.mapping!}
              editorFocus={editorFocus}
              setEditorReady={setEditorReady}
              setEditorError={setEditorError}
              loroManager={session.loroManager}
              syncSource={session.syncSource}
              sourceReady={() => true}
              canEdit={canEdit}
              canComment={canComment}
              editorError={editorError}
              statusChrome={props.statusChrome}
            />
          </Show>

          <MarkdownEditingOverlays
            editor={editor}
            editing={editing}
            source={editingSource}
            canEdit={canEdit}
            useBlockBoundary={props.useBlockBoundary ?? true}
          />
        </div>
      </div>
    </LexicalWrapperContext.Provider>
  );
}
