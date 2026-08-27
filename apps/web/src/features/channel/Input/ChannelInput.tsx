import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { DragInsertIndicator } from '@core/component/LexicalMarkdown/component/misc/DragInsertIndicator';
import {
  createDragInsertStore,
  INSERT_DOCUMENT_MENTION_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import { singleLineMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import {
  clearDragInsertPreview,
  insertDocumentMentionAtDragCoordinates,
  updateDragInsertPreviewFromCoordinates,
} from '@core/component/LexicalMarkdown/utils/dragInsertUtils';
import { isCursorBotId } from '@core/constant/cursorAgent';
import { ENABLE_CHAT_V3_AGENTS } from '@core/constant/featureFlags';
import { useCursorAgentsAccess } from '@core/cursor/flag';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { IUser } from '@core/user/types';
import { uniqueByKey } from '@core/util/compareUtils';
import { isPlatform } from '@core/util/platform';
import {
  chatRuleset,
  handleFileFolderDrop,
  uploadFile,
} from '@core/util/upload';
import type { EntityData } from '@entity';
import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import { isIOS } from '@solid-primitives/platform';
import { CollapsedInput, cn, Surface } from '@ui';
import { $getRoot } from 'lexical';
import {
  type Accessor,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import {
  cursorMentionUser,
  isMacroAiId,
  isMacroCoderId,
  macroAiMentionUser,
  macroCoderMentionUser,
} from '../macroAi';
import { CHANNEL_FILE_PICKER_ACCEPT } from './accepted-file-types';
import { createInputAttachmentTracker } from './attachment-tracker';
import { createConfiguredChannelMarkdownEditor } from './configured-markdown-editor';
import { createCollapsedInputState } from './create-collapsed-input-state';
import { createInputState } from './create-input-state';
import { createTypingTracker } from './create-typing-tracker';
import { FormatButtons } from './FormatButtons';
import { Input } from './Input';
import { createMentionsTracker } from './mentions-tracker';
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
import { entityToDocumentMentionInfo } from './utils/entity-mention';
import { applyInlineFormat, applyNodeFormat } from './utils/formatting';
import { $selectTrailingParagraph } from './utils/select-trailing-paragraph';
import { hasSendableInputContent } from './utils/sendable-content';

export type ChannelInputProps = InputCallbacks & {
  input: InputData;
  markdownNamespace?: string;
  persistenceKey?: InputPersistenceKey;
  attachmentTracker?: InputAttachmentTracker;
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
   * Whether focus leaving the input may collapse it. Defaults to `true`.
   * Composed alternate input faces can disable this while the message face is
   * hidden so it remains expanded for the return transition.
   */
  collapseOnFocusOut?: boolean;
  /**
   * Optional composition slot around the message face inside the shared input
   * surface. Used by alternate input modes that need to preserve the surface
   * while switching content.
   */
  renderContent?: (messageFace: JSX.Element) => JSX.Element;
};

function WebDefaultActions(props: { input: InputData }) {
  return (
    <Input.Actions>
      <Input.Actions.Left>
        <Input.AttachFilesAction />
        <Input.ToggleFormatAction />
        <Show when={isReplyInput(props.input)}>
          <Input.CloseReplyAction />
        </Show>
      </Input.Actions.Left>
      <Input.Actions.Right>
        <Input.SendAction />
      </Input.Actions.Right>
    </Input.Actions>
  );
}

function IosDefaultActions(props: { input: InputData }) {
  return (
    <Input.Actions>
      <Input.Actions.Left>
        <Input.AttachNativeMediaAction />
        <Input.ToggleFormatAction />
        <Show when={isReplyInput(props.input)}>
          <Input.CloseReplyAction />
        </Show>
      </Input.Actions.Left>
      <Input.Actions.Right>
        <Input.SendAction />
      </Input.Actions.Right>
    </Input.Actions>
  );
}

function DefaultActions(props: { input: InputData }) {
  return (
    <Show
      when={isPlatform('ios')}
      fallback={<WebDefaultActions input={props.input} />}
    >
      <IosDefaultActions input={props.input} />
    </Show>
  );
}

export function ChannelInput(props: ChannelInputProps) {
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();
  const mentionsTracker = createMentionsTracker();
  const attachmentTracker =
    props.attachmentTracker ??
    createInputAttachmentTracker({
      initialAttachments: props.input.attachments,
    });
  let clearComposer = () => {};
  // Suppresses focus-out handling during clearComposer's iOS blur/refocus
  // cycle, which is not a user-intended blur.
  let isInternalRefocus = false;

  const typingTracker = createTypingTracker({
    onStartTyping: () => props.onStartTyping?.(),
    onStopTyping: () => props.onStopTyping?.(),
  });

  const inputState = createInputState({
    initialInput: props.input,
    mentions: mentionsTracker.mentions,
    attachmentTracker,
    clearComposer: () => clearComposer(),
    attachFiles: async (files) => {
      await uploadInputAttachments({
        files,
        tracker: attachmentTracker,
        uploadFile: async (file) => {
          return uploadFile(file, chatRuleset, {
            hideProgressIndicator: true,
          });
        },
      });
    },
    clearInput: () => markdownEditor.controls.clear(),
    callbacks: {
      onChange: props.onChange,
      onSend: (snapshot) => {
        typingTracker.stop();
        return props.onSend?.(snapshot);
      },
      onToggleFormatRibbon: props.onToggleFormatRibbon,
      onClose: (snapshot) => {
        typingTracker.stop();
        return props.onClose?.(snapshot);
      },
      onRemoveAttachment: props.onRemoveAttachment,
    },
    persistenceKey: props.persistenceKey,
  });

  const collapsedInput = createCollapsedInputState({
    inputId: () => props.input.id,
    attachFiles: (files) => inputState.commands.attachFiles(files),
  });

  const isCollapsed = () => !!props.collapsible && collapsedInput.isCollapsed();

  let isEditorConnected = false;
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
    markdownEditor.controls.setMarkdown(snapshot.value);
    pendingCursor = options?.cursor;
    attachmentTracker.setAttachments(snapshot.attachments);
    mentionsTracker.setMentions(snapshot.mentions);
    if (options?.focus !== false) focusEditorNow();
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

  const canUseCursor = useCursorAgentsAccess();
  const cursorApiKey = useCursorApiKeyStatusQuery();

  // Macro AI and Macro Coder (flag-gated) are mentionable in every channel,
  // and any bot added to the channel is mentionable too. All are surfaced
  // through the same `@`-mention typeahead as participants and re-tagged as
  // bot mentions at send time.
  const mentionUsers: Accessor<IUser[]> = () => {
    const cursorEnabled =
      canUseCursor() && (cursorApiKey.data?.registered ?? false);
    const base = [
      ...(props.participants?.() ?? []),
      ...(props.bots?.() ?? []),
    ].filter((user) => cursorEnabled || !isCursorBotId(user.id));
    if (
      ENABLE_CHAT_V3_AGENTS() &&
      !base.some((user) => isMacroCoderId(user.id))
    ) {
      base.unshift(macroCoderMentionUser());
    }
    if (
      cursorEnabled &&
      // Hiding it is not enforcement — a mention can still arrive from a
      // copied message or another client — so the harness refuses these too.
      !base.some((user) => isCursorBotId(user.id))
    ) {
      base.unshift(cursorMentionUser());
    }
    if (!base.some((user) => isMacroAiId(user.id))) {
      base.unshift(macroAiMentionUser());
    }
    return uniqueByKey(base, (user) => user.id);
  };

  const markdownEditor = createConfiguredChannelMarkdownEditor({
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
    onChange: (markdown) => {
      inputState.setValue(markdown);
      typingTracker.keystroke();
    },
    onEnter: () => {
      if (isTouchDevice()) return false;
      typingTracker.stop();
      inputState.commands.send();
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
  // On iOS, blur before clearing so dictation finalizes and discards its buffer
  // (otherwise it re-injects the sent text into the cleared editor). Re-focus
  // via rAF so the keyboard stays up: rAF fires after Lexical's update commits,
  // avoiding a conflict where clear()'s $setSelection(null) undoes the focus.
  clearComposer = () => {
    if (isIOS) {
      isInternalRefocus = true;
      markdownEditor.controls.blur();
      markdownEditor.controls.clear();
      requestAnimationFrame(() => {
        markdownEditor.controls.focus();
        isInternalRefocus = false;
      });
    } else {
      markdownEditor.controls.clear();
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
    send: () => inputState.commands.send(),
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
      // Block upstream escape handlers when ESC should close inline menus.
      return markdownEditor.controls.isInlineMenuOpen();
    },
  });

  const renderSurfaceContent = () => {
    const messageFace = (
      <Input.DropZone
        onDragStart={(valid) => inputState.setIsDraggedOver(valid)}
        onDragEnd={() => inputState.setIsDraggedOver(false)}
      >
        <Input.Layout>
          <Input.DropOverlay />
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
          <Input.EditorShell
            ref={setScrollContainer}
            on:click={(event) => {
              if (!isTouchDevice()) {
                event.stopPropagation();
                markdownEditor.controls.focus();
              }
            }}
          >
            <Input.Editor>
              <MarkdownShell
                config={markdownEditor}
                placeholder={props.input.placeholder}
                initialValue={inputState.view().value}
                autofocus={!isTouchDevice() && (props.autofocus ?? true)}
                class="text-sm"
                refFn={attach}
                onConnect={() => {
                  isEditorConnected = true;
                  flushPendingRestore();
                  flushPendingFocus();
                }}
              />
              <DragInsertIndicator
                editor={lexicalEditor()}
                state={entityDragInsertStore}
                active
              />
            </Input.Editor>
          </Input.EditorShell>
          <Input.Attachments kind="media" />
          <Input.Attachments kind="document" />
          <Input.Footer>
            <Switch>
              <Match when={props.children}>{props.children}</Match>
              <Match when>
                <DefaultActions input={inputState.view()} />
              </Match>
            </Switch>
          </Input.Footer>
        </Input.Layout>
      </Input.DropZone>
    );

    return props.renderContent?.(messageFace) ?? messageFace;
  };

  return (
    <Input.Root input={inputState.view()} commands={inputState.commands}>
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
          onSend={() => void inputState.commands.send()}
        />
      </Show>
      <Surface
        onFocusOut={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && e.currentTarget.contains(next)) return;
          if (isInternalRefocus) return;
          if (props.collapseOnFocusOut === false) return;
          collapsedInput.collapse();
        }}
        class={cn(
          'rounded-xl bg-surface touch:rounded-3xl touch:island',
          isCollapsed() && 'hidden',
          isTouchDevice() && 'bg-chrome'
        )}
        hideBorder={isTouchDevice()}
        depth={isTouchDevice() ? 3 : 2}
        solid
      >
        {renderSurfaceContent()}
      </Surface>
    </Input.Root>
  );
}
