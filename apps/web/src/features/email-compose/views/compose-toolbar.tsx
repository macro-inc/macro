import { MAX_ATTACHMENTS_BYTES_SIZE } from '@app/features/email-compose/core/constants';
import { FormatButtons } from '@channel/Input/FormatButtons';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { defaultSelectionData } from '@core/component/LexicalMarkdown/plugins';
import {
  NODE_TRANSFORM,
  type NodeTransformType,
} from '@core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin';
import { fileSelector } from '@core/directive/fileSelector';
import { plural } from '@core/util/string';
import PaperclipIcon from '@phosphor/paperclip.svg?component-solid';
import TextAa from '@phosphor/text-aa.svg';
import Trash from '@phosphor/trash.svg';
import { Button, SendButton } from '@ui';
import { FORMAT_TEXT_COMMAND, type LexicalEditor } from 'lexical';
import { createSignal, Show } from 'solid-js';
import { EmailDateSelector } from '../components/email-date-selector';
import { useCompose } from '../context/compose-context';

export function EmailComposeToolbar(props: {
  editor?: () => LexicalEditor | undefined;
}) {
  const ctx = useCompose();
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(false);
  const expandedActionLabel = () => {
    const schedule = ctx.schedule.state();
    return schedule.type === 'editing' && schedule.intent.type === 'immediate'
      ? undefined
      : schedule.type === 'scheduled' && !schedule.proposedTime
        ? undefined
        : ctx.schedule.actionLabel();
  };

  const handleAddAttachments = (files: File[]) => {
    const currentAttachments = ctx.attachments();

    const attachmentsToAddByteSize = files.reduce((sum, f) => sum + f.size, 0);

    if (attachmentsToAddByteSize >= MAX_ATTACHMENTS_BYTES_SIZE) {
      ctx.attachmentFailure(
        `${plural('Attachment', files.length)} exceed 18MB`
      );
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
      ctx.attachmentFailure("Can't add more attachments", {
        subtext: 'Total attachments exceed 18MB limit',
      });
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
    <Show
      when={!ctx.isMobile()}
      fallback={<MobileToolbar handleAddAttachments={handleAddAttachments} />}
    >
      <Show when={showFormatRibbon()}>
        <div class="flex flex-row w-full gap-2 items-center p-2 -ml-3">
          <FormatButtons
            selectionState={() => defaultSelectionData}
            onInlineFormat={(format) => {
              props.editor?.()?.dispatchCommand(FORMAT_TEXT_COMMAND, format);
            }}
            onNodeFormat={(transform: NodeTransformType) => {
              props.editor?.()?.dispatchCommand(NODE_TRANSFORM, transform);
            }}
          />
        </div>
      </Show>
      <div class="mt-2 flex items-center justify-end gap-1">
        <Show when={ctx.hasDraft()}>
          <Button
            onClick={ctx.onDelete}
            tooltip="Delete draft"
            size="icon-composer"
            disabled={ctx.disabled()}
          >
            <Trash />
          </Button>
        </Show>
        <Show when={!ctx.hideAttachments}>
          <Button
            ref={(el) =>
              fileSelector(el, () => ({
                multiple: true,
                onSelect: handleAddAttachments,
              }))
            }
            tooltip="Attach"
            size="icon-composer"
            disabled={ctx.disabled()}
          >
            <PaperclipIcon />
          </Button>
        </Show>
        <Button
          tooltip="Format"
          size="icon-composer"
          disabled={ctx.disabled()}
          onClick={() => setShowFormatRibbon(!showFormatRibbon())}
        >
          <TextAa />
        </Button>
        <Show when={ctx.scheduleEnabled}>
          <div class="min-w-0 max-w-[45%] shrink">
            <EmailDateSelector
              mobile={false}
              state={ctx.schedule.state()}
              selectedTime={ctx.schedule.selectedTime()}
              onSelectTime={ctx.schedule.onSelect}
              onCancelSchedule={ctx.schedule.onCancel}
              operation={ctx.schedule.operation()}
              disabled={ctx.schedule.pickerDisabled()}
            />
          </div>
        </Show>
        <SendButton
          appearance="composer"
          onClick={() => ctx.onSend()}
          disabled={ctx.isSavingDraft?.() || ctx.primaryActionDisabled()}
          pending={ctx.isSending()}
          tooltip={ctx.sendUnavailableReason?.() ?? ctx.schedule.actionLabel()}
          aria-label={ctx.schedule.actionLabel()}
          actionLabel={expandedActionLabel()}
          shortcut="cmd+enter"
        />
      </div>
    </Show>
  );
}

function MobileToolbar(props: {
  handleAddAttachments: (files: File[]) => void;
}) {
  const ctx = useCompose();

  return (
    <SplitHeaderRight>
      <HeaderIsland class="h-(--mobile-chrome-button-size) p-[5px]">
        <Show when={!ctx.hideAttachments}>
          <div class="relative">
            <Button
              ref={(el) =>
                fileSelector(el, () => ({
                  multiple: true,
                  onSelect: props.handleAddAttachments,
                }))
              }
              size="icon-sm"
              disabled={ctx.disabled()}
            >
              <PaperclipIcon />
            </Button>
          </div>
        </Show>

        <Show when={ctx.scheduleEnabled}>
          <EmailDateSelector
            mobile={ctx.isMobile()}
            state={ctx.schedule.state()}
            selectedTime={ctx.schedule.selectedTime()}
            onSelectTime={ctx.schedule.onSelect}
            onCancelSchedule={ctx.schedule.onCancel}
            operation={ctx.schedule.operation()}
            disabled={ctx.schedule.pickerDisabled()}
            compact
          />
        </Show>
        <SendButton
          tooltip={ctx.sendUnavailableReason?.() ?? ctx.schedule.actionLabel()}
          aria-label={ctx.schedule.actionLabel()}
          disabled={ctx.isSavingDraft?.() || ctx.primaryActionDisabled()}
          pending={ctx.isSending()}
          onClick={() => ctx.onSend()}
        />
      </HeaderIsland>
    </SplitHeaderRight>
  );
}
