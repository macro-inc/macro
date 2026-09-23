import { ComposerEditor } from '@core/component/LexicalMarkdown/component/ComposerEditor';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { DragInsertIndicator } from '@core/component/LexicalMarkdown/component/misc/DragInsertIndicator';
import {
  createDragInsertStore,
  INSERT_DOCUMENT_MENTION_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import { singleLineMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { createComposerLayout } from '@core/component/LexicalMarkdown/utils/create-composer-layout';
import {
  clearDragInsertPreview,
  insertDocumentMentionAtDragCoordinates,
  updateDragInsertPreviewFromCoordinates,
} from '@core/component/LexicalMarkdown/utils/dragInsertUtils';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { createMessageComposer } from '@core/messages/create-message-composer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { IUser } from '@core/user/types';
import { isPlatform } from '@core/util/platform';
import {
  chatRuleset,
  handleFileFolderDrop,
  uploadFile,
} from '@core/util/upload';
import type { EntityData } from '@entity';
import type { MessageParent } from '@service-storage/messages';
import { CollapsedInput, ComposerSurface, cn } from '@ui';
import { $getRoot } from 'lexical';
import {
  type Accessor,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  DictationButton,
  DictationFeedback,
  DictationPanel,
} from '../../dictation/components/dictation-controls';
import { createComposerDictation } from '../../dictation/composer-dictation';
import type { DictationController } from '../../dictation/core/types';
import { useAgentMentionUsers } from '../use-agent-mention-users';
import { useMessageBotMentionUsers } from '../use-channel-bot-mention-users';
import { useMessageParticipants } from '../use-message-participants';
import { CHANNEL_FILE_PICKER_ACCEPT } from './accepted-file-types';
import { createConfiguredChannelMarkdownEditor } from './configured-markdown-editor';
import { createCollapsedInputState } from './create-collapsed-input-state';
import { FormatButtons } from './FormatButtons';
import { Input } from './Input';
import type {
  EntityMentionInsertCoordinates,
  InputAttachmentTracker,
  InputCallbacks,
  InputData,
  InputHandle,
  InputPersistenceKey,
  InputSnapshot,
  RestoreSnapshotOptions,
} from './types';
import { isReplyInput } from './types';
import { uploadInputAttachments } from './upload-attachments';
import { clearComposer as clearComposerPreservingFocus } from './utils/clear-composer';
import { entityToDocumentMentionInfo } from './utils/entity-mention';
import { applyInlineFormat, applyNodeFormat } from './utils/formatting';
import { $selectTrailingParagraph } from './utils/select-trailing-paragraph';
import { hasSendableInputContent } from './utils/sendable-content';

export type ChannelInputProps = InputCallbacks & {
  input: InputData;
  parent?: MessageParent;
  markdownNamespace?: string;
  persistenceKey?: InputPersistenceKey;
  attachmentTracker?: InputAttachmentTracker;
  /**
   * People surfaced in the `@`-mention typeahead. Defaults to the `parent`'s
   * own people: a channel's participants, or the workspace contacts a
   * document's composers offer.
   */
  participants?: Accessor<IUser[]>;
  /** Channel bots surfaced in the `@`-mention typeahead alongside users. */
  bots?: Accessor<IUser[]>;
  onReady?: (handle: InputHandle) => void;
  children?: JSX.Element;
  /** Whether to auto-focus the input on mount. Defaults to `!isTouchDevice()`. */
  autofocus?: boolean;
  /**
   * Render a one-line `CollapsedInput` stand-in until the user clicks it.
   * Defaults to `false`.
   */
  collapsible?: boolean;
  /**
   * Drop the composer's own card chrome (rounding, background, shadow) and sit
   * flat on whatever surface hosts it. For composers that already live inside a
   * card, such as a document margin thread, where the composer's card would
   * read as a second box inside the first.
   */
  flat?: boolean;
};

function WebDefaultActions(props: {
  input: InputData;
  dictation: DictationController;
}) {
  return (
    <>
      <Input.Layout.ActionsLeft>
        <Input.AttachFilesAction />
        <Show when={isReplyInput(props.input)}>
          <Input.CloseReplyAction />
        </Show>
      </Input.Layout.ActionsLeft>
      <Input.Layout.ActionsRight>
        <DictationButton dictation={props.dictation} />
        <Input.SendAction />
      </Input.Layout.ActionsRight>
    </>
  );
}

function IosDefaultActions(props: {
  input: InputData;
  dictation: DictationController;
}) {
  return (
    <>
      <Input.Layout.ActionsLeft>
        <Input.AttachNativeMediaAction />
        <Show when={isReplyInput(props.input)}>
          <Input.CloseReplyAction />
        </Show>
      </Input.Layout.ActionsLeft>
      <Input.Layout.ActionsRight>
        <DictationButton dictation={props.dictation} />
        <Input.SendAction />
      </Input.Layout.ActionsRight>
    </>
  );
}

function DefaultActions(props: {
  input: InputData;
  dictation: DictationController;
}) {
  return (
    <Show
      when={isPlatform('ios')}
      fallback={
        <WebDefaultActions input={props.input} dictation={props.dictation} />
      }
    >
      <IosDefaultActions input={props.input} dictation={props.dictation} />
    </Show>
  );
}

export function ChannelInput(props: ChannelInputProps) {
  const [layout, setLayout] = createSignal<HTMLDivElement>();
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();
  let clearComposer = () => {};
  // Suppresses focus-out handling during clearComposer's iOS blur/refocus
  // cycle, which is not a user-intended blur.
  let isInternalRefocus = false;

  const {
    inputState,
    mentionsTracker,
    attachmentTracker,
    typingTracker,
    onChange,
  } = createMessageComposer({
    input: props.input,
    attachmentTracker: props.attachmentTracker,
    persistenceKey: props.persistenceKey,
    callbacks: props,
    clearEditor: () => clearComposer(),
    trackTyping: () => acceptTyping,
    attachFiles: async (files) => {
      await uploadInputAttachments({
        files,
        tracker: attachmentTracker,
        uploadFile: (file) =>
          uploadFile(file, chatRuleset, { hideProgressIndicator: true }),
      });
    },
  });

  const collapsedInput = createCollapsedInputState({
    inputId: () => props.input.id,
    attachFiles: (files) => inputState.commands.attachFiles(files),
  });

  const isCollapsed = () =>
    !!props.collapsible && collapsedInput.isCollapsed() && !dictation.active();

  let isEditorConnected = false;
  let acceptTyping = false;
  let pendingRestore:
    | {
        snapshot: InputSnapshot;
        options?: RestoreSnapshotOptions;
      }
    | undefined;
  let pendingFocus = false;
  // Caret placement requested by a `cursor: 'trailing-paragraph'` restore.
  // Applied on the next programmatic focus rather than at restore time.
  let pendingCursor: RestoreSnapshotOptions['cursor'];

  const applySnapshot = (
    snapshot: InputSnapshot,
    options?: RestoreSnapshotOptions
  ) => {
    acceptTyping = false;
    markdownEditor.controls.setMarkdown(snapshot.value);
    pendingCursor = options?.cursor;
    attachmentTracker.setAttachments(snapshot.attachments);
    mentionsTracker.setMentions(snapshot.mentions);
    if (options?.focus !== false) focusEditorNow();
    queueMicrotask(() => {
      acceptTyping = true;
    });
  };

  const flushPendingRestore = () => {
    const restore = pendingRestore;
    pendingRestore = undefined;
    if (!restore) return;
    queueMicrotask(() => applySnapshot(restore.snapshot, restore.options));
  };

  const focusEditorNow = () => {
    if (pendingCursor === 'trailing-paragraph') {
      pendingCursor = undefined;
      lexicalEditor().update(() => $selectTrailingParagraph());
    }
    markdownEditor.controls.focus();
  };

  const focusEditor = () => {
    if (!isEditorConnected) {
      pendingFocus = true;
      return;
    }
    focusEditorNow();
  };

  const flushPendingFocus = () => {
    if (!pendingFocus) return;
    pendingFocus = false;
    queueMicrotask(() => focusEditorNow());
  };

  const parentBots =
    !props.bots && props.parent
      ? useMessageBotMentionUsers(() => props.parent!)
      : () => [];
  const parentParticipants =
    !props.participants && props.parent
      ? useMessageParticipants(() => props.parent!)
      : () => [];
  // Connection-prompt behavior for the built-in agents lives in
  // useAgentMentionUsers; participants and channel/document bots feed it here.
  const mentionUsers = useAgentMentionUsers(() => [
    ...(props.participants?.() ?? parentParticipants()),
    ...(props.bots?.() ?? parentBots()),
  ]);

  const markdownEditor = createConfiguredChannelMarkdownEditor({
    groupMentions: !props.parent || props.parent.type === 'channel',
    namespace: props.markdownNamespace ?? 'channel-input-markdown',
    enableMentions: true,
    users: mentionUsers,
    scrollContainer,
    onMentionCreate: (mention) => {
      mentionsTracker.onMentionCreate(mention);
    },
    onMentionRemove: (mention) => {
      mentionsTracker.onMentionRemove(mention);
    },
    onChange,
    onEnter: () => {
      if (isTouchDevice()) return false;
      typingTracker.stop();
      void commands.send();
      return true;
    },
    onPasteFilesAndDirs: (files, directories) => {
      void handleFileFolderDrop(files, directories, (entries) =>
        inputState.commands.attachFiles(entries.map((entry) => entry.file))
      );
    },
    onAttachFromDisk: (files) => inputState.commands.attachFiles(files),
  });
  const markdownHandle = markdownEditor.buildHandle();
  const lexicalEditor = () => markdownHandle.lexical;
  const composerDictation = createComposerDictation(lexicalEditor);
  const dictation: DictationController = {
    ...composerDictation,
    start: () => {
      collapsedInput.expand();
      return composerDictation.start();
    },
  };
  const commands = {
    ...inputState.commands,
    // Keyboard, toolbar, and external handles all share this guard.
    send: async () => (dictation.active() ? false : inputState.commands.send()),
  };
  const { isCompact: oneLineInput } = createComposerLayout(lexicalEditor(), {
    container: layout,
    mode: () =>
      isReplyInput(inputState.view()) ||
      inputState.view().showFormatRibbon ||
      inputState.view().attachments?.length
        ? 'expanded'
        : 'auto',
  });
  const [entityDragInsertStore, setEntityDragInsertStore] =
    createDragInsertStore();

  const isInsideEditorDropBounds = (
    coordinates: EntityMentionInsertCoordinates
  ) => {
    const rect =
      scrollContainer()?.getBoundingClientRect() ??
      lexicalEditor().getRootElement()?.getBoundingClientRect();
    if (!rect) return false;
    return (
      coordinates.clientX >= rect.left &&
      coordinates.clientX <= rect.right &&
      coordinates.clientY >= rect.top &&
      coordinates.clientY <= rect.bottom
    );
  };
  clearComposer = () => {
    isInternalRefocus = true;
    try {
      clearComposerPreservingFocus(
        lexicalEditor(),
        markdownEditor.controls.clear
      );
    } finally {
      isInternalRefocus = false;
    }
  };

  const previewEntityMentionInsertion = (
    coordinates: EntityMentionInsertCoordinates
  ) => {
    updateDragInsertPreviewFromCoordinates({
      editor: lexicalEditor(),
      coordinates,
      setState: setEntityDragInsertStore,
      isValidDropTarget: isInsideEditorDropBounds,
    });
  };

  const clearEntityMentionInsertionPreview = () => {
    clearDragInsertPreview(setEntityDragInsertStore);
  };

  // Insert a mention for an entity dragged in from the soup. When the drop
  // happens over editor content, mirror markdown documents by inserting before
  // or after the nearest top-level node; otherwise keep the old append fallback.
  const insertEntityMention = (
    entity: EntityData,
    coordinates?: EntityMentionInsertCoordinates
  ) => {
    clearEntityMentionInsertionPreview();
    const mentionInfo = entityToDocumentMentionInfo(entity);
    if (!mentionInfo) return;

    if (
      !insertDocumentMentionAtDragCoordinates({
        editor: lexicalEditor(),
        coordinates,
        mentionInfo,
        isValidDropTarget: isInsideEditorDropBounds,
      })
    ) {
      const editor = lexicalEditor();
      editor.update(() => {
        $getRoot().selectEnd();
      });
      editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, mentionInfo);
    }
    markdownEditor.controls.focus();
  };

  props.onReady?.({
    clear: () => markdownEditor.controls.clear(),
    focus: () => {
      // A collapsed pill hides the editor; programmatic focus implies intent
      // to type, so expand first.
      collapsedInput.expand();
      focusEditor();
    },
    send: commands.send,
    attachFiles: (files) => inputState.commands.attachFiles(files),
    insertEntityMention,
    previewEntityMentionInsertion,
    clearEntityMentionInsertionPreview,
    restoreSnapshot: (snapshot, options) => {
      if (!isEditorConnected) {
        pendingRestore = { snapshot, options };
        return;
      }
      applySnapshot(snapshot, options);
    },
  });

  const [attach, scopeId] = useHotkeyDOMScope('channel-input-intercept');
  registerHotkey({
    scopeId,
    description: 'block escape from moving up scope',
    hotkey: ['escape'],
    runWithInputFocused: true,
    hide: true,
    keyDownHandler: () => {
      if (dictation.active()) {
        dictation.cancel();
        return true;
      }
      // Block upstream escape handlers when ESC should close inline menus.
      return markdownEditor.controls.isInlineMenuOpen();
    },
  });

  const renderSurfaceContent = () => {
    return (
      <Input.DropZone
        onDragStart={(valid) => inputState.setIsDraggedOver(valid)}
        onDragEnd={() => inputState.setIsDraggedOver(false)}
      >
        <Input.Layout
          ref={setLayout}
          oneLineInput={oneLineInput()}
          inert={dictation.active()}
          classList={{ invisible: dictation.active() }}
        >
          <Input.DropOverlay />
          <Input.Layout.Body>
            <Input.FormatRibbon>
              <FormatButtons
                selectionState={() => markdownEditor.selection}
                onInlineFormat={(format) =>
                  applyInlineFormat(markdownEditor.lexical, format)
                }
                onNodeFormat={(format) =>
                  applyNodeFormat(markdownEditor.lexical, format)
                }
              />
            </Input.FormatRibbon>
            <Input.Layout.Editor
              ref={setScrollContainer}
              on:click={(event) => {
                if (!isTouchDevice()) {
                  event.stopPropagation();
                  markdownEditor.controls.focus();
                }
              }}
            >
              <Input.Editor>
                <ComposerEditor
                  config={markdownEditor}
                  placeholder={props.input.placeholder}
                  initialValue={inputState.view().value}
                  autofocus={!isTouchDevice() && (props.autofocus ?? true)}
                  class="text-base"
                  refFn={attach}
                  onConnect={() => {
                    isEditorConnected = true;
                    flushPendingRestore();
                    flushPendingFocus();
                    queueMicrotask(() => {
                      acceptTyping = true;
                    });
                  }}
                />
                <DragInsertIndicator
                  editor={lexicalEditor()}
                  state={entityDragInsertStore}
                  active
                />
              </Input.Editor>
            </Input.Layout.Editor>
            <Input.Attachments kind="media" />
            <Input.Attachments kind="document" />
          </Input.Layout.Body>
          <Switch>
            <Match when={props.children}>{props.children}</Match>
            <Match when>
              <DefaultActions input={inputState.view()} dictation={dictation} />
            </Match>
          </Switch>
        </Input.Layout>
      </Input.DropZone>
    );
  };

  return (
    <Input.Root
      input={inputState.view()}
      commands={commands}
      // An inline reply's bottom margin spaces it from the thread below; a
      // flat composer's host card already pads it.
      class={cn(props.flat && 'mb-0')}
    >
      <Show when={isCollapsed()}>
        {/* File picker opened from the CollapsedInput attach button. */}
        <input
          ref={collapsedInput.setFilePickerRef}
          type="file"
          class="hidden"
          multiple
          accept={CHANNEL_FILE_PICKER_ACCEPT}
          onChange={collapsedInput.onFilePickerChange}
          data-collapsed-input-file-picker
        />
        <CollapsedInput
          class="touch:rounded-full touch:island"
          draft={inputState.view().value}
          renderDraft={(draft) => (
            <StaticMarkdown
              markdown={draft()}
              theme={singleLineMarkdownTheme}
              singleLine
            />
          )}
          // Read through the reactive prop — the view freezes the input at
          // mount, but the placeholder can update (e.g. channel name loads).
          placeholder={props.input.placeholder}
          attachmentCount={inputState.view().attachments?.length ?? 0}
          pending={inputState.view().hasPendingAttachments}
          disabled={!hasSendableInputContent(inputState.view())}
          getFocusTarget={() => lexicalEditor().getRootElement()}
          onAttach={collapsedInput.attach}
          onOpen={collapsedInput.expand}
          trailingAction={<DictationButton dictation={dictation} />}
          onSend={() => void commands.send()}
        />
      </Show>
      <Dynamic
        component={props.flat ? 'div' : ComposerSurface}
        onFocusOut={(e: FocusEvent & { currentTarget: HTMLElement }) => {
          const next = e.relatedTarget as Node | null;
          if (next && e.currentTarget.contains(next)) return;
          if (isInternalRefocus) return;
          if (dictation.active()) return;
          collapsedInput.collapse();
        }}
        // `ComposerSurface` stretches itself; a bare div would take its
        // content width inside a centering flex host, such as the margin card.
        class={cn(
          props.flat && 'w-full',
          isCollapsed() && 'hidden',
          !isCollapsed() && 'relative'
        )}
      >
        {renderSurfaceContent()}
        <DictationPanel dictation={dictation} />
      </Dynamic>
      <DictationFeedback dictation={dictation} />
    </Input.Root>
  );
}
