import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { EntityIcon } from '@core/component/EntityIcon';
import { ComposerEditor } from '@core/component/LexicalMarkdown/component/ComposerEditor';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { DragInsertIndicator } from '@core/component/LexicalMarkdown/component/misc/DragInsertIndicator';
import {
  createDragInsertStore,
  INSERT_DOCUMENT_MENTION_COMMAND,
  TYPE_AT_SYMBOL_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import { ACTIONS } from '@core/component/LexicalMarkdown/plugins/actions/actions';
import type { ActionContext } from '@core/component/LexicalMarkdown/plugins/actions/types';
import { singleLineMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { createComposerLayout } from '@core/component/LexicalMarkdown/utils/create-composer-layout';
import {
  clearDragInsertPreview,
  insertDocumentMentionAtDragCoordinates,
  updateDragInsertPreviewFromCoordinates,
} from '@core/component/LexicalMarkdown/utils/dragInsertUtils';
import { handleUserMention } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { isMacroAgentId } from '@core/constant/macroAgent';
import { isMacroNewId } from '@core/constant/macroNew';
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
import AtIcon from '@phosphor/at.svg';
import ChartBarIcon from '@phosphor/chart-bar-horizontal.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import PhoneIcon from '@phosphor/phone.svg';
import type { MessageParent } from '@service-storage/messages';
import { CollapsedInput, ComposerSurface, cn } from '@ui';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
} from 'lexical';
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
import {
  ComposerAddDrawer,
  ComposerAddMenu,
  type ComposerAddMenuGroup,
} from './ComposerAddMenu';
import {
  channelComposerActions,
  createConfiguredChannelMarkdownEditor,
} from './configured-markdown-editor';
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
  /** Handles a failed send while preserving the composer's draft. */
  onSendError?: (error: unknown) => void;
  /** Dismiss the host after Escape has closed inline menus or dictation. */
  onEscape?: () => void;
  onReady?: (handle: InputHandle) => void;
  /** Offers "Start a call" in the add menu; omitted where a call can't start. */
  onStartCall?: () => void;
  /** A call is live in the channel, so the add menu offers to join it. */
  callInProgress?: boolean;
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
  addMenu: JSX.Element;
}) {
  return (
    <>
      <Input.Layout.ActionsLeft>
        {props.addMenu}
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
  addMenu: JSX.Element;
}) {
  return (
    <>
      <Input.Layout.ActionsLeft>
        {props.addMenu}
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
  addMenu: JSX.Element;
}) {
  return (
    <Show
      when={isPlatform('ios')}
      fallback={
        <WebDefaultActions
          input={props.input}
          dictation={props.dictation}
          addMenu={props.addMenu}
        />
      }
    >
      <IosDefaultActions
        input={props.input}
        dictation={props.dictation}
        addMenu={props.addMenu}
      />
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
    onSendError: props.onSendError,
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
  // useAgentMentionUsers; participants and parent agents feed it here.
  const mentionUsers = useAgentMentionUsers(() => [
    ...(props.participants?.() ?? parentParticipants()),
    ...(props.bots?.() ?? parentBots()),
  ]);

  const groupMentions = !props.parent || props.parent.type === 'channel';
  const markdownEditor = createConfiguredChannelMarkdownEditor({
    groupMentions,
    namespace: props.markdownNamespace ?? 'channel-input-markdown',
    resolveAppLink: useMacroMentionLinkResolver(),
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
    sendMessage: () => void commands.send(),
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
  // The add menu's actions are the slash menu's, run from the + instead.
  const actionContext: ActionContext = {
    sourceBlockName: groupMentions ? 'channel' : undefined,
  };
  const sendFromAction = () => void commands.send();
  const slashAction = (id: string) =>
    [...ACTIONS, ...channelComposerActions(sendFromAction)].find(
      (action) => action.id === id
    );
  const runInEditor = (
    run: (editor: LexicalEditor) => void,
    options: { focus: boolean }
  ) => {
    collapsedInput.expand();
    if (options.focus) focusEditor();
    queueMicrotask(() => run(lexicalEditor()));
  };
  const openMentionTypeahead = (editor: LexicalEditor) => {
    // The typeahead opens at a word start; step past a preceding word.
    editor.update(
      () => {
        if (!$isRangeSelection($getSelection())) $getRoot().selectEnd();
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const { anchor } = selection;
        const node = anchor.getNode();
        const previous = $isTextNode(node)
          ? node.getTextContent().slice(anchor.offset - 1, anchor.offset)
          : '';
        if (previous && !/\s/.test(previous)) selection.insertText(' ');
      },
      { discrete: true }
    );
    editor.dispatchCommand(TYPE_AT_SYMBOL_COMMAND, undefined);
  };
  // Whichever Macro the `@macro` typeahead offers: the classic chat reply or
  // the agent-session bot, depending on rollout.
  const macroUser = () =>
    mentionUsers().find(
      (user) => isMacroAgentId(user.id) || isMacroNewId(user.id)
    );
  const addMenuGroups = (): ComposerAddMenuGroup[] => {
    const create = (
      id: string,
      label: string,
      icon: JSX.Element
    ): ComposerAddMenuGroup['items'] => {
      const action = slashAction(id);
      if (!action) return [];
      return [
        {
          id,
          label,
          icon,
          onSelect: () =>
            runInEditor((editor) => action.action(editor, actionContext), {
              focus: false,
            }),
        },
      ];
    };
    const macro = macroUser();
    const startCall = props.onStartCall;
    const callInProgress = !!props.callInProgress;
    return [
      {
        items: [
          {
            id: 'mention',
            label: 'Mention',
            icon: <AtIcon class="size-3.5" />,
            hint: '@',
            onSelect: () => runInEditor(openMentionTypeahead, { focus: true }),
            focusesEditor: true,
          },
          {
            id: 'attach',
            label: 'Attach files',
            icon: <PaperclipIcon class="size-3.5" />,
            onSelect: () => collapsedInput.attach(),
          },
        ],
      },
      {
        label: 'Create',
        items: [
          ...create(
            'task',
            'New task',
            <EntityIcon targetType="task" size="xs" />
          ),
          ...create(
            'poll',
            'New poll',
            <ChartBarIcon class="size-3.5 text-violet" />
          ),
          ...create(
            'form',
            'New form',
            <EntityIcon targetType="form" size="xs" />
          ),
          ...create(
            'document',
            'New document',
            <EntityIcon targetType="md" size="xs" />
          ),
        ],
      },
      {
        items: [
          ...(macro
            ? [
                {
                  id: 'ask-macro',
                  label: 'Ask Macro',
                  icon: <EntityIcon targetType="agent" size="xs" />,
                  hint: '@macro',
                  onSelect: () =>
                    runInEditor(
                      (editor) => {
                        void handleUserMention(macro, {
                          editor,
                          blockName: groupMentions ? 'channel' : undefined,
                        }).then(() =>
                          editor.update(() => {
                            const selection = $getSelection();
                            if ($isRangeSelection(selection))
                              selection.insertText(' ');
                          })
                        );
                      },
                      { focus: true }
                    ),
                  focusesEditor: true,
                },
              ]
            : []),
          ...(startCall
            ? [
                {
                  id: 'call',
                  label: callInProgress ? 'Join call' : 'Start a call',
                  icon: (
                    <PhoneIcon
                      class={cn('size-3.5', callInProgress && 'text-success')}
                    />
                  ),
                  onSelect: startCall,
                },
              ]
            : []),
        ],
      },
    ];
  };
  const [addDrawerOpen, setAddDrawerOpen] = createSignal(false);
  const addMenu = (pill?: boolean) => (
    <ComposerAddMenu
      groups={addMenuGroups()}
      onOpenDrawer={() => setAddDrawerOpen(true)}
      class={pill ? 'not-touch:light-mode:text-composer-ink' : undefined}
    />
  );

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
    snapshot: inputState.snapshot,
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
      if (markdownEditor.controls.isInlineMenuOpen()) return true;
      if (!props.onEscape) return false;
      props.onEscape();
      return true;
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
              <DefaultActions
                input={inputState.view()}
                dictation={dictation}
                // The collapsed pill carries the + while collapsed; one + at
                // a time, so the menu never anchors to a hidden one.
                addMenu={<Show when={!isCollapsed()}>{addMenu()}</Show>}
              />
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
      <ComposerAddDrawer
        groups={addMenuGroups()}
        getEditor={() => lexicalEditor().getRootElement()}
        open={addDrawerOpen()}
        onOpenChange={setAddDrawerOpen}
      />
      {/* File picker opened from the add menu, collapsed or not. */}
      <input
        ref={collapsedInput.setFilePickerRef}
        type="file"
        class="hidden"
        multiple
        accept={CHANNEL_FILE_PICKER_ACCEPT}
        onChange={collapsedInput.onFilePickerChange}
        data-collapsed-input-file-picker
      />
      <Show when={isCollapsed()}>
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
          leadingAction={addMenu(true)}
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
