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
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isMobile } from '@core/mobile/isMobile';
import type { IUser } from '@core/user/types';
import { uniqueByKey } from '@core/util/compareUtils';
import { isPlatform } from '@core/util/platform';
import {
  chatRuleset,
  handleFileFolderDrop,
  uploadFile,
} from '@core/util/upload';
import type { EntityData } from '@entity';
import { isIOS } from '@solid-primitives/platform';
import { makePersisted } from '@solid-primitives/storage';
import { CollapsedInput, cn, Surface } from '@ui';
import { $getRoot } from 'lexical';
import {
  type Accessor,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { isMacroAiId, macroAiMentionUser } from '../macroAi';
import { CHANNEL_FILE_PICKER_ACCEPT } from './accepted-file-types';
import { createInputAttachmentTracker } from './attachment-tracker';
import { createConfiguredChannelMarkdownEditor } from './configured-markdown-editor';
import { createCollapsedInputState } from './create-collapsed-input-state';
import { createInputState } from './create-input-state';
import { createTypingTracker } from './create-typing-tracker';
import { FormatButtons } from './FormatButtons';
import { Input } from './Input';
import { createMentionsTracker } from './mentions-tracker';
import { TaskComposer, type TaskComposerSendPayload } from './TaskComposer';
import { TaskModeSwitch } from './TaskModeSwitch';
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
import type { InputTaskPersistence } from './utils/persistence';
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
  /** Whether to auto-focus the input on mount. Defaults to `!isMobile()`. */
  autofocus?: boolean;
  /**
   * Render a one-line `CollapsedInput` stand-in until the user clicks it.
   * Defaults to `false`.
   */
  collapsible?: boolean;
  /**
   * Fires when a task composed in the input's task mode has been created,
   * so the host can post it into the channel. Providing this enables the
   * message/task mode switch (desktop only).
   */
  onSendTask?: (task: TaskComposerSendPayload) => void;
  /**
   * Persists the task draft and the message/task mode flag across visits
   * (e.g. per channel), the way `persistenceKey` persists the message draft.
   */
  taskPersistence?: InputTaskPersistence;
};

function WebDefaultActions(props: {
  input: InputData;
  onEnterTaskMode?: () => void;
}) {
  return (
    <Input.Actions>
      <Input.Actions.Left>
        <Input.AttachFilesAction />
        <Input.ToggleFormatAction />
        <Show when={props.onEnterTaskMode}>
          <TaskModeSwitch
            checked={false}
            onChange={() => props.onEnterTaskMode?.()}
          />
        </Show>
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

function DefaultActions(props: {
  input: InputData;
  onEnterTaskMode?: () => void;
}) {
  return (
    <Show
      when={isPlatform('ios')}
      fallback={
        <WebDefaultActions
          input={props.input}
          onEnterTaskMode={props.onEnterTaskMode}
        />
      }
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

  // Message/task mode. Task mode swaps the message editor for an embedded
  // task composer. Desktop only — mobile keeps the plain message input.
  const canUseTaskMode = () =>
    !!props.onSendTask && !isPlatform('ios') && !isMobile();
  const taskModeSignal = createSignal(false);
  const [taskModeRequested, setTaskModeRequested] = props.taskPersistence
    ? makePersisted(taskModeSignal, { name: props.taskPersistence.modeKey })
    : taskModeSignal;
  // True when the input opens directly in task mode (persisted from a prior
  // visit); it decides who receives the mount-time autofocus.
  const taskModeRestored = taskModeRequested() === true;
  // Mount the composer on first use only, then keep it alive so a draft
  // survives toggling back and forth.
  const [taskComposerMounted, setTaskComposerMounted] =
    createSignal(taskModeRestored);
  const isTaskMode = () => canUseTaskMode() && taskModeRequested();

  const isCollapsed = () =>
    !!props.collapsible && collapsedInput.isCollapsed() && !isTaskMode();

  // Height morph between the two input faces: pin the wrapper at its current
  // height, swap faces, then transition to the new content height. The
  // wrapper is measured for the start (mid-transition it reflects the
  // animated height); the inner content for the target.
  let morphWrapperEl: HTMLDivElement | undefined;
  let morphContentEl: HTMLDivElement | undefined;
  const [morphHeight, setMorphHeight] = createSignal<number>();
  let morphTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(morphTimer));

  const setTaskMode = (task: boolean) => {
    if (task === taskModeRequested()) return;
    if (task) setTaskComposerMounted(true);
    const from = morphWrapperEl?.offsetHeight;
    setTaskModeRequested(task);
    if (!task) focusEditor();
    if (from === undefined) return;
    setMorphHeight(from);
    requestAnimationFrame(() => {
      // Reading offsetHeight forces a layout with the start height committed,
      // so the height change below actually transitions.
      const to = morphContentEl?.offsetHeight;
      if (to === undefined) return;
      setMorphHeight(to);
      clearTimeout(morphTimer);
      morphTimer = setTimeout(() => setMorphHeight(undefined), 350);
    });
  };

  const onTaskComposerSend = (task: TaskComposerSendPayload) => {
    props.onSendTask?.(task);
    setTaskMode(false);
  };

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

  // Macro AI is mentionable in every channel, and any bot added to the
  // channel is mentionable too. Both are surfaced through the same
  // `@`-mention typeahead as participants and re-tagged as bot mentions at
  // send time.
  const mentionUsers: Accessor<IUser[]> = () => {
    const base = [...(props.participants?.() ?? []), ...(props.bots?.() ?? [])];
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
      if (isMobile()) return false;
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
          class="mobile:rounded-full mobile:island"
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
          if (isTaskMode()) return;
          collapsedInput.collapse();
        }}
        class={cn(
          'rounded-xl mobile:rounded-3xl mobile:island',
          isCollapsed() && 'hidden',
          isMobile() && 'bg-chrome'
        )}
        hideBorder={isMobile()}
        depth={isMobile() ? 3 : 2}
        solid
      >
        <div
          ref={(el) => {
            morphWrapperEl = el;
          }}
          class={cn(
            morphHeight() !== undefined &&
              'overflow-hidden transition-[height] duration-300 ease-in-out'
          )}
          style={{
            height:
              morphHeight() !== undefined ? `${morphHeight()}px` : undefined,
          }}
        >
          <div
            ref={(el) => {
              morphContentEl = el;
            }}
          >
            <div
              class={cn(
                isTaskMode() && 'hidden',
                taskComposerMounted() &&
                  'animate-[dialog-fullscreen-open_200ms_ease-out]'
              )}
              data-input-face="message"
            >
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
                    onClick={(event) => {
                      if (!isMobile()) {
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
                        autofocus={
                          !isMobile() &&
                          (props.autofocus ?? true) &&
                          !isTaskMode()
                        }
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
                        <DefaultActions
                          input={inputState.view()}
                          onEnterTaskMode={
                            canUseTaskMode()
                              ? () => setTaskMode(true)
                              : undefined
                          }
                        />
                      </Match>
                    </Switch>
                  </Input.Footer>
                </Input.Layout>
              </Input.DropZone>
            </div>
            <Show when={taskComposerMounted()}>
              <div
                class={cn(
                  !isTaskMode() && 'hidden',
                  'animate-[dialog-fullscreen-open_200ms_ease-out]'
                )}
                data-input-face="task"
              >
                <TaskComposer
                  active={isTaskMode()}
                  autofocus={
                    taskModeRestored
                      ? !isMobile() && (props.autofocus ?? true)
                      : true
                  }
                  draftPersistenceKey={props.taskPersistence?.draftKey}
                  modeSwitch={
                    <TaskModeSwitch
                      checked={true}
                      onChange={() => setTaskMode(false)}
                    />
                  }
                  onSend={onTaskComposerSend}
                />
              </div>
            </Show>
          </div>
        </div>
      </Surface>
    </Input.Root>
  );
}
