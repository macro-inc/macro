import { SplitHeaderRight } from '@app/component/split-layout/components/SplitHeader';
import { FormatButtons } from '@channel/Input/FormatButtons';
import { EmailDateSelector } from '@block-email/component/email-date-selector';
import { MAX_ATTACHMENTS_BYTES_SIZE } from '@block-email/constants';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { toast } from '@core/component/Toast/Toast';
import { Tooltip } from '@core/component/Tooltip';
import { ENABLE_EMAIL_SCHEDULED_SEND } from '@core/constant/featureFlags';
import { fileSelector } from '@core/directive/fileSelector';
import { isMobile } from '@core/mobile/isMobile';
import { plural } from '@core/util/string';
import ArrowUp from '@icon/bold/arrow-up-bold.svg';
import TextAa from '@icon/regular/text-aa.svg';
import Trash from '@icon/regular/trash.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import PaperPlane from '@macro-icons/wide/paper-plane-cutout.svg';
import DotsThreeIcon from '@phosphor-icons/core/bold/dots-three-bold.svg?component-solid';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import PaperclipHorizontalIcon from '@phosphor-icons/core/regular/paperclip-horizontal.svg?component-solid';
import { Button } from '@ui/components/Button';
import { defaultSelectionData } from 'core/component/LexicalMarkdown/plugins';
import {
  NODE_TRANSFORM,
  type NodeTransformType,
} from 'core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin';
import { FORMAT_TEXT_COMMAND, type LexicalEditor } from 'lexical';
import { createSignal, Show } from 'solid-js';
import { useCompose } from './ComposeContext';

export function EmailComposeToolbar(props: {
  editor?: () => LexicalEditor | undefined;
}) {
  const ctx = useCompose();
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(false);
  let attachButtonRef!: HTMLDivElement;

  const handleAddAttachments = (files: File[]) => {
    const currentAttachments = ctx.attachments();

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

    ctx.onAddAttachments(
      files.map((file) => ({
        type: 'local',
        file,
      }))
    );
  };

  return (
    <>
      <Show when={showFormatRibbon()}>
        <div class="flex flex-row w-full gap-2 items-center p-2 -ml-3">
          <FormatButtons
            selectionState={() => defaultSelectionData}
            includeQuote
            onInlineFormat={(format) => {
              props.editor?.()?.dispatchCommand(FORMAT_TEXT_COMMAND, format);
            }}
            onNodeFormat={(transform: NodeTransformType) => {
              props.editor?.()?.dispatchCommand(NODE_TRANSFORM, transform);
            }}
          />
        </div>
      </Show>
      <div class="flex flex-row w-full h-8 justify-between items-center space-x-2 allow-css-brackets mt-2">
        <Show
          when={!isMobile()}
          fallback={
            <MobileToolbar
              attachButtonRef={attachButtonRef}
              handleAddAttachments={handleAddAttachments}
            />
          }
        >
          <div class="flex flex-row items-center gap-2">
            <Show when={!ctx.hideAttachments}>
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
                  disabled={ctx.disabled()}
                >
                  <PaperclipIcon class="h-5" />
                </Button>
              </div>
            </Show>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={ctx.disabled()}
              onClick={() => {
                setShowFormatRibbon(!showFormatRibbon());
              }}
            >
              <TextAa />
            </Button>
            <Show when={ENABLE_EMAIL_SCHEDULED_SEND && ctx.onSendTimeChange}>
              <EmailDateSelector
                sendTime={ctx.sendTime()}
                onSendTimeChange={ctx.onSendTimeChange}
                disabled={ctx.scheduleSendDisabled?.()}
              />
            </Show>
            <Show when={ctx.hasDraft()}>
              <Button
                onclick={ctx.onDelete}
                tooltip="Delete draft"
                class="aspect-square *:h-5 p-1"
              >
                <Trash />
              </Button>
            </Show>
          </div>

          <div class="flex items-center gap-2">
            <Show when={ctx.onSaveDraft}>
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  ctx.isSending() || ctx.isSavingDraft?.() || ctx.disabled()
                }
                onClick={() => void ctx.onSaveDraft?.()}
              >
                {ctx.isSavingDraft?.() ? 'Saving…' : 'Save Draft'}
              </Button>
            </Show>
            <Tooltip
              tooltip={ctx.sendTime() ? 'Send time is scheduled' : undefined}
            >
              <button
                disabled={
                  ctx.isSending() ||
                  ctx.isSavingDraft?.() ||
                  ctx.disabled() ||
                  !!ctx.sendTime()
                }
                onClick={() => ctx.onSend()}
                class="text-ink-muted hover:scale-115 transition ease-in-out flex-col items-center rounded-full p-[0.25lh] hover:bg-transparent disabled:opacity-30"
              >
                <Show
                  when={!ctx.isSending()}
                  fallback={<Spinner class="size-6 animate-spin" />}
                >
                  <div class="group hover:bg-accent transition ease-in-out size-6 border border-accent rounded-full flex items-center justify-center p-0">
                    <ArrowUp class="group-hover:text-input! group-hover:fill-input! text-accent-ink! fill-accent! size-4 transition ease-in-out" />
                  </div>
                </Show>
              </button>
            </Tooltip>
          </div>
        </Show>
      </div>
    </>
  );
}

function MobileToolbar(props: {
  attachButtonRef: HTMLDivElement;
  handleAddAttachments: (files: File[]) => void;
}) {
  const ctx = useCompose();

  return (
    <SplitHeaderRight>
      <div class="flex items-center pl-2">
        <div class="relative" ref={props.attachButtonRef}>
          <Button
            ref={(el) =>
              fileSelector(el, () => ({
                multiple: true,
                onSelect: props.handleAddAttachments,
              }))
            }
            tooltip="Attach"
            class="aspect-square p-1"
            disabled={ctx.disabled()}
          >
            <PaperclipHorizontalIcon class="h-5" />
          </Button>
        </div>
        <Show when={ENABLE_EMAIL_SCHEDULED_SEND && ctx.onSendTimeChange}>
          <EmailDateSelector
            sendTime={ctx.sendTime()}
            onSendTimeChange={ctx.onSendTimeChange}
            disabled={ctx.scheduleSendDisabled?.()}
            compact
          />
        </Show>
        <Tooltip
          tooltip={ctx.sendTime() ? 'Send time is scheduled' : undefined}
        >
          <Show when={ctx.onSaveDraft}>
            <Button
              variant="secondary"
              size="sm"
              disabled={
                ctx.isSending() || ctx.isSavingDraft?.() || ctx.disabled()
              }
              onClick={() => void ctx.onSaveDraft?.()}
            >
              {ctx.isSavingDraft?.() ? 'Saving…' : 'Draft'}
            </Button>
          </Show>
          <Button
            disabled={
              ctx.isSending() ||
              ctx.isSavingDraft?.() ||
              ctx.disabled() ||
              !!ctx.sendTime()
            }
            onClick={() => ctx.onSend()}
          >
            <PaperPlane class="size-4.5 text-accent" />
          </Button>
        </Tooltip>
        <DropdownMenu placement="bottom-end">
          <DropdownMenu.Trigger as={Button} class="aspect-square p-1">
            <DotsThreeIcon class="h-4.5" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenuContent>
              <MenuItem
                text="Delete Draft"
                disabled={!ctx.hasDraft()}
                onClick={ctx.onDelete}
              />
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </SplitHeaderRight>
  );
}
