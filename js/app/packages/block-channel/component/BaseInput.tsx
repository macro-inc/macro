import {
  isDraggingOverChannelSignal,
  isValidChannelDragSignal,
} from '@block-channel/signal/attachment';
import type { sendMessage } from '@block-channel/signal/channel';
import { handleFileUpload } from '@block-channel/utils/inputAttachments';
import { isInBlock } from '@core/block';
import { handleFoldersInput } from '@core/client/zipWorkerClient';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { IconButton } from '@core/component/IconButton';
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
import type { UploadFileEntry } from '@core/util/upload';
import { handleFileFolderDrop } from '@core/util/upload';
import PlusIcon from '@icon/regular/plus.svg';
import FormatIcon from '@icon/regular/text-aa.svg';
import XIcon from '@icon/regular/x.svg';
import { logger } from '@observability';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import PaperPlaneRight from '@phosphor-icons/core/fill/paper-plane-right-fill.svg?component-solid';
import type { SimpleMention } from '@service-comms/generated/models/simpleMention';
import { createCallback } from '@solid-primitives/rootless';
import { leading, throttle } from '@solid-primitives/scheduled';
import { activeElement } from 'app/signal/focus';
import { toast } from 'core/component/Toast/Toast';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { tabbable } from 'tabbable';
import { staticFileClient } from '../../service-static-files/client';
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
  onSend: typeof sendMessage;
  /** callback to be executed when the user changes the input */
  onChange: (content: string) => void;
  /** callback to be executed when the user clears the input */
  onEmpty: () => void;
  /** callback to be executed when the user presses escape */
  escHandler?: () => void;
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
  /** called after onSend resolves and after BaseInput cleanup */
  afterSend?: () => void | Promise<void>;
  /** called when the user uses the up arrow or shift + tab to leave the first line of input */
  onFocusLeaveStart?: (e: KeyboardEvent) => void;
  /** optional setter to reflect local typing state with 500ms debounce for gating UI updates */
  setLocalTyping?: (isTyping: boolean) => void;
  /** the list of users in the channel  */
  channelUsers?: () => IUser[];
};

/** the time after a user stops typing before we consider them idle */
const ACTIVITY_TIMEOUT_MS = 2000;

export function BaseInput(props: BaseInputProps) {
  let containerRef!: HTMLDivElement;
  const key = props.inputAttachments.key;
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(false);
  const [isDraggedOver, setIsDraggedOver] = createSignal(false);

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
  let inactivityTimeout: ReturnType<typeof setTimeout> | undefined;
  let localTypingTimeout: ReturnType<typeof setTimeout> | undefined;
  let viewportObserver: IntersectionObserver | undefined;

  const [showAttachMenu, setShowAttachMenu] = createSignal(false);
  const [attachMenuAnchorRef, setAttachMenuAnchorRef] =
    createSignal<HTMLDivElement>();

  function resetInactivityTimeout() {
    if (inactivityTimeout) {
      clearTimeout(inactivityTimeout);
    }
    inactivityTimeout = setTimeout(() => stopTyping(), ACTIVITY_TIMEOUT_MS);
  }

  function stopTyping() {
    if (typing()) {
      setTyping(false);
      props.onStopTyping();
      if (localTypingTimeout) clearTimeout(localTypingTimeout);
      props.setLocalTyping?.(false);
    }
  }

  const startTyping = leading(
    throttle,
    createCallback(() => {
      if (!typing()) {
        setTyping(true);
        props.onStartTyping();
      }
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
  } = useChannelMarkdownArea();

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
    if (inactivityTimeout) {
      clearTimeout(inactivityTimeout);
    }
    stopTyping();
    if (localTypingTimeout) clearTimeout(localTypingTimeout);
    props.setLocalTyping?.(false);
    viewportObserver?.disconnect();
    if (markdownState().trim() === '') {
      props.onEmpty();
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
    const content = markdownState();
    console.log('content', content);
    const args = {
      content: content,
      attachments: props.inputAttachments.store[key] ?? [],
      mentions: allMentions(),
    };

    props
      .onSend(args)
      .then(() => {
        props.inputAttachments.setStore(key, []);
        clearMarkdownArea();
        focusMarkdownArea();
        stopTyping();
        return props.afterSend?.();
      })
      .catch((err) => {
        logger.error('onSend failed', { error: err });
      });

    return true;
  }

  function handleChange(input: string) {
    if (input.trim() === '') {
      stopTyping();
      if (localTypingTimeout) clearTimeout(localTypingTimeout);
      props.setLocalTyping?.(false);
      props.onEmpty();
    } else {
      startTyping();
      resetInactivityTimeout();
      props.setLocalTyping?.(true);
      if (localTypingTimeout) clearTimeout(localTypingTimeout);
      localTypingTimeout = setTimeout(() => {
        props.setLocalTyping?.(false);
      }, 500);
      props.onChange(input);
    }
  }

  async function onMarkdownAreaPasteFilesAndDirs(
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ) {
    // If any directories present, ignore raw files to avoid phantom duplicates
    const filesToUse = directories.length > 0 ? [] : files;

    const zippedPromises = handleFoldersInput(directories);
    const zipped = await Promise.all(zippedPromises);
    const dirEntries: UploadFileEntry[] = zipped
      .filter((f): f is File => !!f)
      .map((file) => ({ file, isFolder: true }));
    const fileEntryPromises = filesToUse.map(
      (entry) =>
        new Promise<File>((resolve, reject) => {
          entry.file(
            (f) => resolve(f),
            (err) => reject(err)
          );
        })
    );
    const plainFiles = await Promise.all(fileEntryPromises);
    const fileEntries: UploadFileEntry[] = plainFiles.map((file) => ({
      file,
      isFolder: false,
    }));
    const entries: UploadFileEntry[] = [...fileEntries, ...dirEntries];
    let uploadedCount = 0;
    handleFileUpload(entries, props.inputAttachments, () => {
      uploadedCount++;
      if (uploadedCount === entries.length) {
        props.onChange(markdownState());
      }
    });
  }

  const videoAttachments = () =>
    attachments().filter((a) => a.blockName === STATIC_VIDEO);

  const imageAttachments = () =>
    attachments().filter((a) => a.blockName === STATIC_IMAGE);

  const documentAttachments = () =>
    attachments().filter((a) => !isStaticAttachmentType(a.blockName));

  const onEscape = () => {
    if (markdownState().trim() === '') {
      props.escHandler?.();
    }
    blurMarkdownArea();
    return true;
  };

  return (
    <div
      class="relative flex flex-col flex-1 items-center justify-between bg-input border-1 border-edge focus-within:bracket-offset-2"
      ref={containerRef}
      use:fileFolderDrop={{
        onDrop: (files, folders) => {
          handleFileFolderDrop(files, folders, (uploadEntries) =>
            handleFileUpload(uploadEntries, {
              store: props.inputAttachments.store,
              setStore: props.inputAttachments.setStore,
              key: key,
            })
          );
        },
        folder: true,
        onDragStart: () => {
          setIsDraggedOver(true);
        },
        onDragEnd: () => {
          setIsDraggedOver(false);
        },
      }}
    >
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
              ? undefined
              : () => {
                  if (hasPendingAttachments()) {
                    return true;
                  }
                  return handleSend();
                }
          }
          onBlur={stopTyping}
          users={props.channelUsers}
          onChange={handleChange}
          onPasteFilesAndDirs={onMarkdownAreaPasteFilesAndDirs}
          initialValue={props.initialValue?.()}
          useBlockBoundary={true}
          onEscape={onEscape}
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
        </div>
        <button
          disabled={hasPendingAttachments()}
          onClick={() => {
            handleSend();
          }}
          class="text-ink-muted bg-transparent rounded-full hover:scale-110! transition ease-in-out delay-150 flex flex-col justify-center items-center"
        >
          <div class="bg-transparent rounded-full size-8 flex flex-row justify-center items-center">
            <Show
              when={!hasPendingAttachments()}
              fallback={
                <Spinner class="w-5 h-5 animate-spin cursor-disabled" />
              }
            >
              <PaperPlaneRight
                width={20}
                height={20}
                class="!text-accent-ink !fill-accent"
              />
            </Show>
          </div>
        </button>
      </div>
    </div>
  );
}
