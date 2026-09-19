import { CollabProvider } from '@core/component/LexicalMarkdown/collaboration/CollabProvider';
import { DecoratorRenderer } from '@core/component/LexicalMarkdown/component/core/DecoratorRenderer';
import { EmojiMenu } from '@core/component/LexicalMarkdown/component/menu/EmojiMenu';
import { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu';
import { SnippetsMenu } from '@core/component/LexicalMarkdown/component/menu/SnippetsMenu';
import {
  getErrorDescription,
  type MarkdownEditorErrors,
} from '@core/component/LexicalMarkdown/constants';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  awaitPlugin,
  DefaultShortcuts,
  documentMetadataPlugin,
  keyboardShortcutsPlugin,
  markdownPastePlugin,
  mentionsPlugin,
  textPastePlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { emojisPlugin } from '@core/component/LexicalMarkdown/plugins/emojis/emojisPlugin';
import { snippetsPlugin } from '@core/component/LexicalMarkdown/plugins/snippets';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  editorFocusSignal,
  editorIsEmpty,
  initializeEditorEmpty,
} from '@core/component/LexicalMarkdown/utils';
import {
  AwaitNode,
  CommentNode,
  createPeerIdValidator,
  InlineSearchNode,
  peerIdPlugin,
} from '@macro-inc/lexical-core';
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
import { useBlockCollabParent } from './blockParent';
import {
  type CollabSurfaceSessionOptions,
  createCollabSurfaceSession,
} from './createCollabSurface';

/** Imperative handle for embedding surfaces in composer-style UIs. */
export type CollabMdSurfaceControls = {
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

export type CollabMdSurfaceProps = {
  /**
   * The stable, caller-supplied surface id (a uuid). The component
   * load-or-creates: the first mount anywhere ensures the surface exists,
   * every later mount joins the same session.
   */
  surfaceId: string;
  /** Markdown seed used only if this mount creates the surface. */
  initialMarkdown?: string;
  /**
   * Whether the caller may edit. UI-only: the server enforces the real
   * permission via the connection token's access level, so a lying caller
   * merely gets its updates rejected. Defaults to editable.
   */
  canEdit?: Accessor<boolean>;
  /** Whether the caller may comment. Defaults to false. */
  canComment?: Accessor<boolean>;
  /** See {@link CollabSurfaceSessionOptions.optimisticSnapshot}. */
  optimisticSnapshot?: Uint8Array;
  /** Lexical namespace, for devtools disambiguation. */
  namespace?: string;
  /** Class applied to the outer container. */
  class?: string;
  /** Placeholder shown while the surface is empty. */
  placeholder?: string;
  /** Called once the editor is live (initial state applied, engine running). */
  onReady?: () => void;
  /** Receives the imperative controls once, at mount. */
  onControls?: (controls: CollabMdSurfaceControls) => void;
  /** Called when the editor enters an error state. */
  onError?: (error: MarkdownEditorErrors) => void;
  /** Optional status UI rendered by the collab provider. */
  statusChrome?: JSX.Element;
};

/**
 * A self-contained collaborative markdown surface: give it a `surfaceId` and
 * it renders a live multi-user Lexical editor synced through sync-service —
 * remote edits merge in real time, cursors render for other peers, offline
 * edits buffer in the WAL, and state persists in the surface's Loro session.
 *
 * The primitive intentionally excludes block chrome: no comments margin, no
 * history UI, no presence header (pass `statusChrome` for that).
 */
export function CollabMdSurface(props: CollabMdSurfaceProps) {
  const canEdit = props.canEdit ?? (() => true);
  const canComment = props.canComment ?? (() => false);

  // The parent entity is always the enclosing block's entity (a channel
  // block ⇒ that channel, an md/task block ⇒ that document); throws when
  // mounted outside a block or in a block with no entity mapping.
  const parent = useBlockCollabParent();

  const session = createCollabSurfaceSession(props.surfaceId, {
    parent,
    initialMarkdown: props.initialMarkdown,
    optimisticSnapshot: props.optimisticSnapshot,
  });
  onCleanup(session.dispose);

  const [editorReady, setEditorReady] = createSignal(false);
  const [editorError, setEditorError] =
    createSignal<MarkdownEditorErrors | null>(null);
  const [editorHasNoContent, setEditorHasNoContent] = createSignal(false);

  const isContentEditable = () => canEdit() && !editorError();

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

  const mentionsMenuOperations = createMenuOperations();
  const emojiMenuOperations = createMenuOperations();
  const snippetsMenuOperations = createMenuOperations();

  // Collab is the point of this component, so the validator is always live:
  // it keeps this peer from committing another peer's in-flight inline nodes
  // (mentions, emoji searches, snippets).
  const peerId = () => session.loroManager.peerIdStr;
  const peerIdValidator = createPeerIdValidator(peerId, true);

  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<string>(setMarkdownState, 'markdown')
    .history(400, session.loroManager)
    .use(
      emojisPlugin({
        menu: emojiMenuOperations,
        peerIdValidator,
      })
    )
    .use(
      mentionsPlugin({
        menu: mentionsMenuOperations,
        peerIdValidator,
        sourceDocumentId: props.surfaceId,
        disableMentionTracking: true,
      })
    )
    .use(
      snippetsPlugin({
        menu: snippetsMenuOperations,
        peerIdValidator,
        sourceDocumentId: props.surfaceId,
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
    )
    .use(
      peerIdPlugin({
        peerId,
        nodes: [InlineSearchNode, CommentNode, AwaitNode],
      })
    );

  createEffect(() => {
    editor.setEditable(canEdit());
  });

  props.onControls?.({
    getMarkdown: () => markdownState(),
    clear: () => initializeEditorEmpty(editor, peerId),
    focus: () => editor.focus(),
    getLexical: () => editor,
    isInlineMenuOpen: () =>
      mentionsMenuOperations.isOpen() ||
      emojiMenuOperations.isOpen() ||
      snippetsMenuOperations.isOpen(),
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
            Failed to connect to this surface.
          </div>
        </Show>
        <div class="relative" ref={editorContainerRef}>
          <div
            ref={(el) => {
              onElementConnect(el, () => {
                editor.setRootElement(el);
              });
            }}
            contentEditable={isContentEditable()}
            class="w-full max-w-full outline-none"
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

          <DecoratorRenderer editor={editor} />

          <EmojiMenu
            editor={editor}
            menu={emojiMenuOperations}
            useBlockBoundary={false}
          />
          <MentionsMenu
            editor={editor}
            menu={mentionsMenuOperations}
            useBlockBoundary={false}
            disableMentionTracking={true}
          />
          <SnippetsMenu
            editor={editor}
            menu={snippetsMenuOperations}
            useBlockBoundary={false}
            sourceDocumentId={props.surfaceId}
          />
        </div>
      </div>
    </LexicalWrapperContext.Provider>
  );
}
