import ArrowUp from '@icon/bold/arrow-up-bold.svg';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import Trash from '@icon/regular/trash.svg';
import { FormatRibbon } from '@block-channel/component/FormatRibbon';
import { MacroSignatureButton } from '@block-email/component/MacroSignatureButton';
import { MAX_ATTACHMENTS_BYTES_SIZE } from '@block-email/constants';
import { useHasPaidAccess } from '@core/auth';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { createFilesReadyHandler } from '@core/component/LexicalMarkdown/utils/fileUploadUtils';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { handleFileFolderDrop } from '@core/util/upload';
import TextAa from '@icon/regular/text-aa.svg';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import PaperclipHorizontalIcon from '@phosphor-icons/core/regular/paperclip-horizontal.svg?component-solid';
import DotsThreeIcon from '@phosphor-icons/core/bold/dots-three-bold.svg?component-solid';
import { useUserId } from '@core/context/user';
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
import PaperPlane from '@macro-icons/wide/paper-plane-cutout.svg';
import {
  type Accessor,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { type FocusableElement, tabbable } from 'tabbable';
import { makeAttachmentPublic } from '../util/makeAttachmentPublic';
import { Button } from '@ui/components/Button';
import { fileSelector } from '@core/directive/fileSelector';
import { toast } from '@core/component/Toast/Toast';
import { plural } from '@core/util/string';
import type { DraftFormAttachment } from '@block-email/component/createEmailFormState';
import { EmailAttachmentPill } from '@block-email/component/AttachmentPill';
import { EmailDateSelector } from '@block-email/component/email-date-selector';
import { ENABLE_EMAIL_SCHEDULED_SEND } from '@core/constant/featureFlags';
import { SplitHeaderRight } from '@app/component/split-layout/components/SplitHeader';
import { isMobile } from '@core/mobile/isMobile';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';

false && fileFolderDrop;

type ComposeEmailInputProps = {
  inputRef?: (el: HTMLDivElement) => void;
  captureEditor?: (editor: LexicalEditor) => void;
  onSubmit: () => void;
  disabled?: boolean;
  isSubmitting?: boolean;
  hasDraft?: boolean;
  onDraftDeletePress?: VoidFunction;
  isDraftSaving?: boolean;
  attachments?: DraftFormAttachment[];
  initialHtml?: string;
  onAddAttachments?: (attachments: DraftFormAttachment[]) => void;
  onRemoveAttachment?: (attachment: DraftFormAttachment) => void;
  onContentChange?: (content: string) => void;
  sendTime?: Date | null;
  onSendTimeChange?: (date: Date | null) => void;
  mobileScrollRef?: Accessor<HTMLElement | undefined>;
};

export function ComposeEmailInput(props: ComposeEmailInputProps) {
  const hasPaidAccess = useHasPaidAccess();

  const [editor, setEditor] = createSignal<LexicalEditor>();

  const [isDragging, setIsDragging] = createSignal<boolean>();

  const [showFormatRibbon, setShowFormatRibbon] = createSignal<boolean>(false);

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

  function handleSend() {
    props.onSubmit();
  }

  onMount(() => {
    const container = composeContainerRef();
    if (!container) return;
    attachComposeHotkeys(container);
  });

  const onAddFilesAndDirs = (
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ) => {
    const editor_ = editor();
    if (!editor_) return;

    handleFileFolderDrop(
      files,
      directories,
      createFilesReadyHandler(
        editor_,
        undefined,
        undefined,
        undefined,
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

  const captureEditor = (editor: LexicalEditor) => {
    setEditor(editor);
    props.captureEditor?.(editor);
  };

  return (
    <div
      ref={setComposeContainerRef}
      class="relative flex flex-col flex-1 items-center justify-between min-h-0"
    >
      <div class="w-full h-full min-h-60 sm:max-h-full mobile:flex-1 flex flex-col">
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
          class="grow w-full h-full flex flex-col cursor-text placeholder:text-ink-placeholder placeholder:opacity-50 overflow-auto"
          ref={bodyDiv}
          onclick={() => {
            editor()?.focus();
          }}
          use:fileFolderDrop={{
            onDragStart: () => setIsDragging(true),
            onDragEnd: () => setIsDragging(false),
            onDrop: (files, dirs) => {
              handleFileFolderDrop(files, dirs, (u) =>
                handleAddAttachments(u.map((f) => f.file))
              );
            },
          }}
        >
          <div class={`${!isDragging() && 'hidden'} absolute inset-0`}>
            <FileDropOverlay>Drop file(s) to attach</FileDropOverlay>
          </div>
          <MarkdownTextarea
            domRef={props.inputRef}
            captureEditor={captureEditor}
            scrollRef={props.mobileScrollRef}
            initialHtml={props.initialHtml}
            class="text-sm break-words text-ink mobile:overflow-auto h-auto"
            editable={() => !props.disabled}
            placeholder="Use `@` to reference files"
            watermark={!hasPaidAccess() ? <MacroSignatureButton /> : undefined}
            onChange={props.onContentChange}
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
        <div class="flex flex-wrap items-center gap-2">
          <For each={props.attachments}>
            {(attachment) => {
              const handleRemoveAttachment = () => {
                props.onRemoveAttachment?.(attachment);
              };
              return (
                <Switch>
                  <Match when={attachment.type === 'local' && attachment}>
                    {(attachment) => (
                      <EmailAttachmentPill
                        attachment={{
                          fileName: attachment().file.name,
                          mimeType: attachment().file.type,
                        }}
                        removable
                        onRemove={handleRemoveAttachment}
                      />
                    )}
                  </Match>
                  <Match when={attachment.type === 'remote' && attachment}>
                    {(attachment) => (
                      <EmailAttachmentPill
                        attachment={{
                          fileName: attachment().fileName,
                          mimeType: attachment().contentType,
                        }}
                        removable
                        onRemove={handleRemoveAttachment}
                      />
                    )}
                  </Match>
                  <Match when={attachment.type === 'forwarded' && attachment}>
                    {(attachment) => (
                      <EmailAttachmentPill
                        attachment={{
                          fileName: attachment().fileName,
                          mimeType: attachment().mimeType,
                        }}
                        removable
                        onRemove={handleRemoveAttachment}
                      />
                    )}
                  </Match>
                </Switch>
              );
            }}
          </For>
        </div>
      </div>
      <div class="flex flex-row w-full h-8 justify-between items-center space-x-2 allow-css-brackets mt-2">
        <Show
          when={!isMobile()}
          fallback={
            <SplitHeaderRight>
              <div class="flex items-center pl-2">
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
                    <PaperclipHorizontalIcon class="h-5" />
                  </Button>
                </div>
                <Show when={ENABLE_EMAIL_SCHEDULED_SEND}>
                  <EmailDateSelector
                    sendTime={props.sendTime}
                    onSendTimeChange={props.onSendTimeChange}
                    compact
                  />
                </Show>
                <Button
                  disabled={props.isSubmitting || props.disabled}
                  onClick={() => {
                    handleSend();
                  }}
                >
                  <PaperPlane class="size-4.5 text-accent" />
                </Button>
                <DropdownMenu placement="bottom-end">
                  <DropdownMenu.Trigger as={Button} class="aspect-square p-1">
                    <DotsThreeIcon class="h-4.5" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenuContent>
                      <MenuItem
                        text="Delete Draft"
                        disabled={!props.hasDraft}
                        onClick={props.onDraftDeletePress}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </div>
            </SplitHeaderRight>
          }
        >
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
            <Show when={ENABLE_EMAIL_SCHEDULED_SEND}>
              <EmailDateSelector
                sendTime={props.sendTime}
                onSendTimeChange={props.onSendTimeChange}
              />
            </Show>
            <Show when={props.hasDraft && !props.isDraftSaving}>
              <Button
                onclick={props.onDraftDeletePress}
                tooltip="Delete draft"
                class="aspect-square *:h-5 p-1"
              >
                <Trash />
              </Button>
            </Show>
            <Show when={props.isDraftSaving}>
              <div class="aspect-square p-1 flex items-center justify-center">
                <Spinner class="size-5 animate-spin text-ink-muted" />
              </div>
            </Show>
          </div>

          <Button
            disabled={props.isSubmitting || props.disabled}
            onClick={() => {
              handleSend();
            }}
            class="text-ink-muted hover:scale-115 transition ease-in-out flex-col items-center rounded-full p-[0.25lh] hover:bg-transparent disabled:opacity-30"
          >
            <Show
              when={!props.isSubmitting}
              fallback={<Spinner class="size-6 animate-spin cursor-disabled" />}
            >
              <div class="group hover:bg-accent transition ease-in-out size-6 border border-accent rounded-full flex items-center justify-center p-0">
                <ArrowUp class="group-hover:!text-input group-hover:!fill-input !text-accent-ink !fill-accent size-4 transition ease-in-out" />
              </div>
            </Show>
          </Button>
        </Show>
      </div>
    </div>
  );
}
