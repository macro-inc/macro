import {
  isDraggingOverChannelSignal,
  isValidChannelDragSignal,
} from '@block-channel/signal/attachment';
import type { sendMessage } from '@block-channel/signal/channel';
import { handleFileUpload } from '@block-channel/utils/inputAttachments';
import { isInBlock } from '@core/block';
import { BrightJoins } from '@core/component/BrightJoins';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { IconButton } from '@core/component/IconButton';
import { setEditorStateFromMarkdown } from '@core/component/LexicalMarkdown/utils';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import {
  type InputAttachment,
  isStaticAttachmentType,
  STATIC_IMAGE,
  STATIC_VIDEO,
} from '@core/store/cacheChannelInput';
import type { IUser } from '@core/user';
import type { UploadInput } from '@core/util/upload';
import { handleFileFolderDrop } from '@core/util/upload';
import ArrowUp from '@icon/bold/arrow-up-bold.svg';
import Spinner from '@icon/bold/spinner-gap-bold.svg';
import PlusIcon from '@icon/regular/plus.svg';
import FormatIcon from '@icon/regular/text-aa.svg';
import Trash from '@icon/regular/trash.svg';
import XIcon from '@icon/regular/x.svg';
import { logger } from '@observability';
import type { SimpleMention } from '@service-comms/generated/models/simpleMention';
import { staticFileClient } from '@service-static-files/client';
import { createCallback } from '@solid-primitives/rootless';
import { leading, throttle } from '@solid-primitives/scheduled';
import { activeElement } from 'app/signal/focus';
import { toast } from 'core/component/Toast/Toast';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  type Accessor,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { tabbable } from 'tabbable';
import { ActionButton } from './ActionButton';
import { AttachMenu } from './AttachMenu';
import { Attachment } from './Attachment';
import { FormatRibbon } from './FormatRibbon';
import { useChannelMarkdownArea } from './MarkdownArea';

false && fileFolderDrop;

type InputAttachmentsStore = {
  store: Record<string, InputAttachment[]>;
  setStore: SetStoreFunction<Record<string, InputAttachment[]>>;
  key: string;
};

type BaseInputProps = {
  /** callback to be executed when the user clicks the send button
   * or presses enter */
  onSend: (args: Parameters<typeof sendMessage>[0]) => Promise<void>;
  /** callback to be executed when the user changes the input */
  onChange: (content: string) => void;
  /** initial value of the input */
  initialValue?: Accessor<string>;
  /** placeholder text to be displayed */
  placeholder: string;
  /** callback when the user start typing */
  onStartTyping: () => void;
  /** callback when the user stops typing and becomes idle */
  onStopTyping: () => void;
  /** keyed store for input attachments */
  inputAttachments: InputAttachmentsStore;
  /** when true, focus on mount (respecting viewport and device checks) */
  autoFocusOnMount?: boolean;
  /** external focus trigger: if getter returns true, focus then call clearer */
  shouldFocus?: boolean;
  clearShouldFocus?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** called after onSend resolves and after BaseInput cleanup */

  afterSend?: () => void | Promise<void>;
  /** called when the user uses the up arrow or shift + tab to leave the first line of input */
  onFocusLeaveStart?: (e: KeyboardEvent) => void;
  /** optional setter to reflect local typing state with 500ms debounce for gating UI updates */
  setLocalTyping?: (isTyping: boolean) => void;
  /** the list of users in the channel  */
  channelUsers?: () => IUser[];
  domRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
  /** callback to be called to "clear the input" */
  onEmptyBlur?: () => void;
  /** whether this input is for a reply (affects styling) */
  isReplyInput?: boolean;
};

/** the time after a user stops typing before we consider them idle. we want smooth remote changes, but local changes should happen more immediately. */
const REMOTE_ACTIVITY_TIMEOUT_MS = 2000;
const LOCAL_ACTIVITY_TIMEOUT_MS = 500;

export function BaseInput(props: BaseInputProps) {
  let containerRef!: HTMLDivElement;
  const key = props.inputAttachments.key;
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(false);
  const [isDraggedOver, setIsDraggedOver] = createSignal(false);
  const [isPendingSend, setIsPendingSend] = createSignal(false);
  const [isValidChannelDrag] = isInBlock()
    ? isValidChannelDragSignal
    : createSignal(false);

  const [isDraggingOverChannel, setIsDraggingOverChannel] = isInBlock()
    ? isDraggingOverChannelSignal
    : createSignal(false);

  const attachments = createMemo(() => props.inputAttachments.store[key] ?? []);

  const hasPendingAttachments = createMemo(() =>
    attachments().some((item) => item.pending)
  );

  const [typing, setTyping] = createSignal(false);
  let remoteInactivityTimeout: ReturnType<typeof setTimeout> | undefined;
  let localInactivityTimeout: ReturnType<typeof setTimeout> | undefined;
  let viewportObserver: IntersectionObserver | undefined;

  const [showAttachMenu, setShowAttachMenu] = createSignal(false);
  const [attachMenuAnchorRef, setAttachMenuAnchorRef] =
    createSignal<HTMLDivElement>();

  function resetInactivityTimeout() {
    if (remoteInactivityTimeout) {
      clearTimeout(remoteInactivityTimeout);
    }
    if (localInactivityTimeout) {
      clearTimeout(localInactivityTimeout);
    }
    remoteInactivityTimeout = setTimeout(
      () => stopRemoteTyping(),
      REMOTE_ACTIVITY_TIMEOUT_MS
    );
    localInactivityTimeout = setTimeout(
      () => stopLocalTyping(),
      LOCAL_ACTIVITY_TIMEOUT_MS
    );
  }

  function stopRemoteTyping() {
    if (typing()) {
      setTyping(false);
      props.onStopTyping();
    }
  }

  function stopLocalTyping() {
    props.setLocalTyping?.(false);
  }

  function stopTyping() {
    stopRemoteTyping();
    stopLocalTyping();
  }

  const startTyping = leading(
    throttle,
    createCallback(() => {
      if (!typing()) {
        setTyping(true);
        props.onStartTyping();
      }
      props.setLocalTyping?.(true);
    }),
    1000
  );

  const {
    focus: focusMarkdownArea,
    blur: blurMarkdownArea,
    clear: clearMarkdownArea,
    state: markdownState,
    formatState: markdownFormatState,
    setInlineFormat,
    setNodeFormat,
    mentions,
    MarkdownArea,
    editor,
    ref,
  } = useChannelMarkdownArea();

  createRenderEffect(() => {
    const currentRef = ref();
    if (currentRef) props.domRef?.(currentRef);
  });

  const allMentions: Accessor<SimpleMention[]> = () =>
    mentions().map((m) => ({
      entity_type: m.itemType,
      entity_id: m.itemId,
    }));

  const [attachFn, scopeId] = useHotkeyDOMScope('channel.baseInput');

  onMount(() => {
    attachFn(containerRef);

    if (!isTouchDevice && !isMobileWidth()) {
      setTimeout(() => {
        if (
          props.autoFocusOnMount === true ||
          props.autoFocusOnMount === undefined
        ) {
          focusMarkdownArea();
        }
      }, 0);
    }

    if (ref() && props.onFocus) {
      const markdownElement = ref()!;
      const handleFocusIn = () => {
        props.onFocus?.();
      };

      markdownElement.addEventListener('focusin', handleFocusIn);

      onCleanup(() => {
        markdownElement.removeEventListener('focusin', handleFocusIn);
      });
    }
  });

  const onFocusLeaveEnd = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const tabbableElements = tabbable(containerRef);
    if (!tabbableElements.length) {
      return;
    }
    const inputElIndex = tabbableElements.findIndex(
      (el) => el.classList.contains('md') && el.tagName === 'DIV'
    );
    if (inputElIndex === -1) {
      return;
    }
    const nextEl = tabbableElements[inputElIndex + 1];
    if (!nextEl) {
      return;
    }
    nextEl.focus();
  };

  registerHotkey({
    hotkey: ['enter'],
    scopeId: scopeId,
    description: 'Send message',
    condition: () => {
      return (
        (activeElement()?.classList.contains('md') &&
          activeElement()?.tagName === 'DIV') ??
        false
      );
    },
    keyDownHandler: () => {
      return true;
    },
    hotkeyToken: TOKENS.channel.sendMessage,
  });

  // Focus when external shouldFocus signal is set to true
  createEffect(() => {
    if (props.shouldFocus) {
      if (!isMobileWidth()) {
        requestAnimationFrame(() => {
          focusMarkdownArea();
          props.clearShouldFocus?.();
        });
      } else {
        props.clearShouldFocus?.();
      }
    }
  });

  onCleanup(() => {
    if (remoteInactivityTimeout) {
      clearTimeout(remoteInactivityTimeout);
    }
    stopTyping();
    viewportObserver?.disconnect();
    if (markdownState().trim() === '') {
      props.onEmptyBlur?.();
    }
  });

  function onAttach(attachment: InputAttachment) {
    // prevent duplicate attachments
    const list = attachments();
    if (list.find((a) => a.id === attachment.id)) return;
    if (list.length >= 10) {
      toast.failure('You can only attach up to 10 files at a time');
      return;
    }
    props.inputAttachments.setStore(key, (prev = []) => [...prev, attachment]);
    focusMarkdownArea();
    props.onChange(markdownState());
  }

  function removeAttachment(attachment: InputAttachment) {
    if (attachment.blockName === STATIC_IMAGE) {
      staticFileClient
        .deleteFile({
          file_id: attachment.id,
        })
        .catch((err) => {
          console.error('error in deleting file', err);
        });
    }
    props.inputAttachments.setStore(key, (prev = []) =>
      prev.filter((a) => a.id !== attachment.id)
    );
    focusMarkdownArea();
    props.onChange(markdownState());
  }

  function handleSend() {
    if (isPendingSend()) return false;
    setIsPendingSend(true);
    const content = markdownState();

    const args = {
      content: content,
      attachments: props.inputAttachments.store[key] ?? [],
      mentions: allMentions(),
    };

    clearMarkdownArea();
    focusMarkdownArea();

    props
      .onSend(args)
      .then(() => {
        props.inputAttachments.setStore(key, []);
        stopTyping();
        return props.afterSend?.();
      })
      .catch((_) => {
        // Restore the stashed editor state
        clearMarkdownArea();
        try {
          setEditorStateFromMarkdown(editor, content);
        } catch (e) {
          logger.error('Failed to restore editor state after send error', {
            error: e,
          });
        }
        focusMarkdownArea();
      })
      .finally(() => {
        setIsPendingSend(false);
      });

    return true;
  }

  function handleChange(input: string) {
    if (input.trim() === '') {
      stopTyping();
    } else {
      startTyping();
      resetInactivityTimeout();
      props.onChange(input);
    }
  }

  async function onMarkdownAreaPasteFilesAndDirs(
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ) {
    const onFilesReady = (uploadEntries: UploadInput[]) => {
      handleFileUpload(uploadEntries, props.inputAttachments, (_attachment) => {
        props.onChange(markdownState());
      });
    };
    return handleFileFolderDrop(files, directories, onFilesReady);
  }

  const videoAttachments = () =>
    attachments().filter((a) => a.blockName === STATIC_VIDEO);

  const imageAttachments = () =>
    attachments().filter((a) => a.blockName === STATIC_IMAGE);

  const documentAttachments = () =>
    attachments().filter((a) => !isStaticAttachmentType(a.blockName));

  const handleBlur = () => {
    blurMarkdownArea();
    if (markdownState().trim() === '') {
      props.onEmptyBlur?.();
    }
    return true;
  };

  return (
    <div
      class="relative flex flex-col flex-1 items-center justify-between bg-input border-t border-x border-edge-muted rounded-t-[5px] -mb-[7px]"
      classList={{
        'rounded-b-[5px] border-b mb-4': props.isReplyInput,
      }}
      ref={containerRef}
      use:fileFolderDrop={{
        onDrop: (files, folders) => {
          setIsDraggingOverChannel(false);
          handleFileFolderDrop(files, folders, (uploadEntries) =>
            handleFileUpload(uploadEntries, {
              store: props.inputAttachments.store,
              setStore: props.inputAttachments.setStore,
              key: key,
            })
          );
        },
        onDragStart: () => {
          setIsDraggedOver(true);
        },
        onDragEnd: () => {
          setIsDraggedOver(false);
        },
      }}
    >
      <Show when={!props.isReplyInput}>
        <BrightJoins dots={[false, false, true, true]} />
      </Show>
      <Show when={isDraggedOver() || isDraggingOverChannel()}>
        <FileDropOverlay valid={isValidChannelDrag()}>
          <Show when={!isValidChannelDrag()}>
            <div class="font-mono text-failure">
              [!] Invalid attachment file
            </div>
          </Show>
          <div class="font-mono">
            Drop any file here to add it to the conversation
          </div>
        </FileDropOverlay>
      </Show>
      <Show when={showFormatRibbon()}>
        <FormatRibbon
          state={markdownFormatState}
          inlineFormat={setInlineFormat}
          nodeFormat={setNodeFormat}
        />
      </Show>
      <div
        class="transition-all duration-150 px-3 pt-2 sm:pb-4 overflow-y-auto placeholder:text-ink-placeholder text-ink w-full text-sm"
        onClick={(e) => {
          e.stopPropagation();
          focusMarkdownArea();
        }}
      >
        {/* Disable enter to submit on mobile */}
        <MarkdownArea
          placeholder={props.placeholder}
          onEnter={
            isMobileWidth()
              ? (_e) => false
              : (_e) => {
                  if (hasPendingAttachments() || isPendingSend()) {
                    return true;
                  }
                  return handleSend();
                }
          }
          onBlur={() => {
            props.onBlur?.();
            stopTyping();
            handleBlur();
          }}
          users={props.channelUsers}
          onChange={handleChange}
          onPasteFilesAndDirs={onMarkdownAreaPasteFilesAndDirs}
          initialValue={props.initialValue?.()}
          useBlockBoundary={true}
          onEscape={handleBlur}
          dontFocusOnMount
          onFocusLeaveStart={props.onFocusLeaveStart}
          onFocusLeaveEnd={onFocusLeaveEnd}
        />
      </div>
      <Show when={videoAttachments()?.length > 0}>
        <div class="flex flex-row w-full px-2 py-1 gap-2 flex-wrap">
          <For each={videoAttachments()}>
            {(attachment) => (
              <Attachment attachment={attachment} remove={removeAttachment} />
            )}
          </For>
        </div>
      </Show>
      <Show when={imageAttachments()?.length > 0}>
        <div class="flex flex-row w-full px-2 py-1 gap-2 flex-wrap">
          <For each={imageAttachments()}>
            {(attachment) => (
              <Attachment attachment={attachment} remove={removeAttachment} />
            )}
          </For>
        </div>
      </Show>
      <Show when={documentAttachments()?.length > 0}>
        <div class="flex flex-row w-full px-2 py-1 gap-2 flex-wrap">
          <For each={documentAttachments()}>
            {(attachment) => (
              <Attachment attachment={attachment} remove={removeAttachment} />
            )}
          </For>
        </div>
      </Show>
      <div class="flex flex-row w-full h-8 justify-between items-center p-2 mb-2 space-x-2 allow-css-brackets">
        <Show when={showAttachMenu()}>
          <AttachMenu
            anchorRef={attachMenuAnchorRef()!}
            close={() => setShowAttachMenu(false)}
            containerRef={containerRef!}
            open={showAttachMenu()}
            onAttach={onAttach}
            inputAttachmentsStore={props.inputAttachments}
          />
        </Show>
        <div class="flex flex-row items-center gap-2">
          <IconButton
            icon={showAttachMenu() ? XIcon : PlusIcon}
            theme="base"
            ref={setAttachMenuAnchorRef}
            onClick={() => setShowAttachMenu((prev) => !prev)}
          />

          <ActionButton
            tooltip="Format"
            onClick={(e) => {
              e.preventDefault();
              setShowFormatRibbon((prev) => !prev);
            }}
            clicked={showFormatRibbon()}
          >
            <FormatIcon width={20} height={20} />
          </ActionButton>
          <Show when={props.isReplyInput && props.onEmptyBlur}>
            <ActionButton
              tooltip="Delete reply"
              onClick={(e) => {
                e.preventDefault();
                props.onEmptyBlur?.();
              }}
            >
              <Trash width={20} height={20} />
            </ActionButton>
          </Show>
        </div>
        <button
          disabled={hasPendingAttachments()}
          onClick={() => {
            handleSend();
          }}
          class="text-ink-muted hover:scale-115 transition ease-in-out flex flex-col justify-center items-center size-6 rounded-full"
        >
          <Show
            when={!hasPendingAttachments() && !isPendingSend()}
            fallback={<Spinner class="size-6 animate-spin cursor-disabled" />}
          >
            <div class="group hover:bg-accent transition ease-in-out size-6 border border-accent rounded-full flex items-center justify-center">
              <ArrowUp class="group-hover:!text-input group-hover:!fill-input !text-accent-ink !fill-accent size-4 transition ease-in-out" />
            </div>
          </Show>
        </button>
      </div>
    </div>
  );
}
