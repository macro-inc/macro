import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { FormatRibbon } from '@block-channel/component/FormatRibbon';
import { MacroSignatureButton } from '@block-email/component/MacroSignatureButton';
import {
  MACRO_EMAIL_SIGNATURE,
  MAX_ATTACHMENTS_BYTES_SIZE,
} from '@block-email/constants';
import { useHasPaidAccess } from '@core/auth';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import {
  createFilesReadyHandler,
  getDragDropPosition,
} from '@core/component/LexicalMarkdown/utils/fileUploadUtils';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { handleFileFolderDrop } from '@core/util/upload';
import TextAa from '@icon/regular/text-aa.svg';
import { $appendWatermarkNodeToLast } from '@lexical-core';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import ArrowFatLineUp from '@phosphor-icons/core/fill/arrow-fat-line-up-fill.svg?component-solid';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import { useUserId } from '@service-gql/client';
import { defaultSelectionData } from 'core/component/LexicalMarkdown/plugins';
import {
  NODE_TRANSFORM,
  type NodeTransformType,
} from 'core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import { createSignal, onMount, Show } from 'solid-js';
import { type FocusableElement, tabbable } from 'tabbable';
import { makeAttachmentPublic } from '../util/makeAttachmentPublic';
import { prepareEmailBody } from '../util/prepareEmailBody';
import { Button } from '@ui/components/Button';
import { fileSelector } from '@core/directive/fileSelector';
import { toast } from '@core/component/Toast/Toast';
import { plural } from '@core/util/string';

false && fileFolderDrop;

export type ComposeInputData = {
  body: {
    text: string;
    html: string;
    raw: string;
  };
};

export type ComposeAttachment =
  | {
      type: 'local';
      file: File;
      attachmentID?: string;
    }
  | {
      type: 'remote';
      url: string;
      fileName: string;
      contentType: string;
      attachmentID: string;
      fileSize: number;
    };

type ComposeEmailInputProps = {
  inputRef?: (el: HTMLDivElement) => void;
  onSubmit: (data: ComposeInputData) => void;
  disabled?: boolean;
  loading?: boolean;
  isSubmitting?: boolean;
  attachments?: ComposeAttachment[];
  onAddAttachments?: (attachments: ComposeAttachment[]) => void;
};

export function ComposeEmailInput(props: ComposeEmailInputProps) {
  const hasPaidAccess = useHasPaidAccess();

  const [editor, setEditor] = createSignal<LexicalEditor>();

  const [isDragging, setIsDragging] = createSignal<boolean>();

  const [showFormatRibbon, setShowFormatRibbon] = createSignal<boolean>(false);

  const [content, setContent] = createSignal('');

  const panel = useSplitPanel();

  const focusSibling = (direction: 'next' | 'prev') => {
    const panelRef = panel?.panelRef();
    if (!panelRef) return;
    const tabbableEls = tabbable(panelRef);
    const activeEl = document.activeElement;
    const activeElIndex = tabbableEls.indexOf(activeEl as FocusableElement);
    if (activeElIndex > -1) {
      const ndx = activeElIndex + (direction === 'next' ? 1 : -1);
      if (ndx < 0 || ndx >= tabbableEls.length) return false;
      const prevEl = tabbableEls[ndx];
      if (!prevEl) return false;
      prevEl.focus();
      return true;
    } else {
      tabbableEls.at(-1)?.focus();
      return true;
    }
  };

  useUserId();

  let bodyDiv!: HTMLDivElement;
  let attachButtonRef!: HTMLDivElement;

  // Set up hotkey scope for the compose message component
  const [attachComposeHotkeys, composeHotkeyScope] =
    useHotkeyDOMScope('compose-message');
  const [composeContainerRef, setComposeContainerRef] = createSignal<
    HTMLElement | undefined
  >();

  async function handleSend() {
    const currentEditor = editor();

    // We handle cleaning up the signature after we've sent the request because
    // otherwise the `bodyMacro` signal would update after the clean up call and
    // not contain the signature in the request data
    const cleanupWatermark = $appendWatermarkNodeToLast(
      currentEditor,
      !hasPaidAccess() ? MACRO_EMAIL_SIGNATURE : undefined
    );

    const prepared = prepareEmailBody(currentEditor, undefined);
    if (!prepared) return;

    const bodyMacro = content();

    props.onSubmit({
      body: {
        text: prepared.bodyText,
        html: prepared.bodyHtml,
        raw: bodyMacro,
      },
    });

    cleanupWatermark();
  }

  onMount(() => {
    const container = composeContainerRef();
    if (!container) return;
    attachComposeHotkeys(container);
  });

  const onAddFilesAndDirs = (
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[],
    dropEvent?: DragEvent
  ) => {
    const editor_ = editor();
    if (!editor_) return;

    const getPositionCallback = dropEvent
      ? () => getDragDropPosition(editor_, dropEvent, true)
      : undefined;

    handleFileFolderDrop(
      files,
      directories,
      createFilesReadyHandler(
        editor_,
        undefined,
        undefined,
        getPositionCallback,
        (uploadedItemIds) => {
          uploadedItemIds.forEach((itemId) => {
            makeAttachmentPublic(itemId);
          });
        },
        { width: 542, height: 542 }
      )
    );
  };

  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: composeHotkeyScope,
    description: 'Send email',
    keyDownHandler: () => {
      handleSend();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: 'email.send',
    displayPriority: 10,
  });

  const handleAddAttachments = (files: File[]) => {
    const currentAttachments = props.attachments ?? [];

    const attachmentsToAddByteSize = files.reduce((sum, f) => sum + f.size, 0);

    if (attachmentsToAddByteSize >= MAX_ATTACHMENTS_BYTES_SIZE) {
      toast.failure(`${plural('Attachment', files.length)} exceed 18MB`);
      return;
    }

    const currentAttachmentsByteSize = currentAttachments.reduce(
      (sum, a) => sum + (a.type === 'local' ? a.file.size : a.fileSize),
      0
    );

    if (
      currentAttachmentsByteSize + attachmentsToAddByteSize >=
      MAX_ATTACHMENTS_BYTES_SIZE
    ) {
      toast.failure(
        "Can't add more attachments",
        'Total attachments exceed 18MB limit'
      );
      return;
    }

    props.onAddAttachments?.(
      files.map((file) => ({
        type: 'local',
        file,
      }))
    );
  };

  return (
    <div
      ref={setComposeContainerRef}
      class="relative flex flex-col flex-1 items-center justify-between min-h-0"
    >
      <div class="w-full h-full flex flex-col min-h-0">
        <Show when={showFormatRibbon()}>
          <FormatRibbon
            class="-ml-3"
            state={structuredClone(defaultSelectionData)}
            inlineFormat={(format: TextFormatType) => {
              editor()?.dispatchCommand(FORMAT_TEXT_COMMAND, format);
            }}
            nodeFormat={(transform: NodeTransformType) => {
              editor()?.dispatchCommand(NODE_TRANSFORM, transform);
            }}
          />
        </Show>

        <div
          class="min-h-60 grow w-full h-full flex flex-col cursor-text placeholder:text-ink-placeholder placeholder:opacity-50 overflow-auto"
          ref={bodyDiv}
          onclick={() => {
            editor()?.focus();
          }}
          use:fileFolderDrop={{
            onDragStart: () => setIsDragging(true),
            onDragEnd: () => setIsDragging(false),
            onDrop: onAddFilesAndDirs,
          }}
        >
          <div class={`${!isDragging() && 'hidden'} absolute inset-0`}>
            <FileDropOverlay>Drop file(s) to attach</FileDropOverlay>
          </div>
          <MarkdownTextarea
            domRef={props.inputRef}
            captureEditor={setEditor}
            class="text-sm break-words text-ink"
            editable={() => !props.disabled}
            placeholder="Use `@` to reference files"
            watermark={!hasPaidAccess() ? <MacroSignatureButton /> : undefined}
            onChange={setContent}
            onFocusLeaveStart={(e) => {
              e.preventDefault();
              focusSibling('prev');
            }}
            onFocusLeaveEnd={(e) => {
              e.preventDefault();
              focusSibling('next');
            }}
            portalScope="local"
            onPasteFilesAndDirs={onAddFilesAndDirs}
          />
        </div>
      </div>
      <div class="flex flex-row w-full h-8 justify-between items-center space-x-2 allow-css-brackets mt-2">
        <div class="flex flex-row items-center gap-2">
          <div class="relative" ref={attachButtonRef}>
            <Button
              ref={(el) =>
                fileSelector(el, () => ({
                  multiple: true,
                  onSelect: handleAddAttachments,
                }))
              }
              tooltip="Attach"
              class="aspect-square p-1"
              disabled={props.disabled}
            >
              <PaperclipIcon class="h-5" />
            </Button>
          </div>
          <DeprecatedIconButton
            theme="base"
            icon={TextAa}
            disabled={props.disabled}
            onclick={() => {
              setShowFormatRibbon(!showFormatRibbon());
            }}
          />
        </div>
        <button
          type="button"
          disabled={props.loading || props.isSubmitting || props.disabled}
          onClick={() => {
            handleSend();
          }}
          class="text-ink-muted focus:scale-110 hover:scale-110 transition ease-in-out delay-150 flex gap-2 justify-center items-center hover:bg-hover py-1 px-2 text-sm"
        >
          <Show
            when={!props.loading && !props.isSubmitting}
            fallback={<Spinner class="w-5 h-5 animate-spin cursor-disabled" />}
          >
            <span class="font-medium font-mono uppercase">Send</span>
            <ArrowFatLineUp
              width={20}
              height={20}
              class="text-accent-ink fill-accent rotate-90"
            />
          </Show>
        </button>
      </div>
    </div>
  );
}
