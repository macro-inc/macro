import { FormatButtons } from '@channel/Input/FormatButtons';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { defaultSelectionData } from '@core/component/LexicalMarkdown/plugins';
import {
  NODE_TRANSFORM,
  type NodeTransformType,
} from '@core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin';
import { fileSelector } from '@core/directive/fileSelector';
import PaperclipIcon from '@phosphor/paperclip.svg?component-solid';
import TextAa from '@phosphor/text-aa.svg';
import Trash from '@phosphor/trash.svg';
import { Button, SendButton } from '@ui';
import { FORMAT_TEXT_COMMAND, type LexicalEditor } from 'lexical';
import { createSignal, Show } from 'solid-js';
import { EmailDateSelector } from '../components/email-date-selector';
import { EmailScheduleSummary } from '../components/email-schedule-summary';
import { MobileComposeActions } from '../components/mobile-compose-actions';
import { useCompose } from '../context/compose-context';

export function EmailComposeToolbar(props: {
  editor?: () => LexicalEditor | undefined;
  /** Embedded drafts keep their controls in the card on phones too. */
  inline?: boolean;
}) {
  const ctx = useCompose();
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(false);

  return (
    <Show when={props.inline || !ctx.isMobile()} fallback={<MobileToolbar />}>
      <Show when={showFormatRibbon() && !ctx.disabled()}>
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
      <div class="mt-2 flex min-w-0 justify-end">
        <div class="flex shrink-0 items-center gap-1">
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
                  onSelect: ctx.onAddAttachments,
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
            <div class="shrink-0">
              <EmailDateSelector
                mobile={false}
                compact
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
            tooltip={
              ctx.sendUnavailableReason?.() ?? ctx.schedule.actionLabel()
            }
            aria-label={ctx.schedule.actionLabel()}
            shortcut="cmd+enter"
          />
        </div>
      </div>
    </Show>
  );
}

function MobileToolbar() {
  const ctx = useCompose();
  const hasScheduleSummary = () => {
    const state = ctx.schedule.state();
    return state.type === 'scheduled' || state.intent.type === 'later';
  };

  return (
    <>
      <SplitHeaderLeft>
        <Show when={hasScheduleSummary()}>
          <HeaderIsland class="max-w-[55cqw] shrink px-2">
            <EmailScheduleSummary
              state={ctx.schedule.state()}
              operation={ctx.schedule.operation()}
              onSelectTime={ctx.schedule.onSelect}
              onCancelSchedule={ctx.schedule.onCancel}
              onCheckStatus={ctx.schedule.onCheckStatus}
            />
          </HeaderIsland>
        </Show>
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <MobileComposeActions
          attachRef={
            ctx.hideAttachments
              ? undefined
              : (el) =>
                  fileSelector(el, () => ({
                    multiple: true,
                    onSelect: ctx.onAddAttachments,
                  }))
          }
          editingDisabled={ctx.disabled()}
          scheduleControl={
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
          }
          sendLabel={ctx.schedule.actionLabel()}
          sendTooltip={ctx.sendUnavailableReason?.()}
          sendDisabled={!!ctx.isSavingDraft?.() || ctx.primaryActionDisabled()}
          sending={ctx.isSending()}
          onSend={() => ctx.onSend()}
        />
      </SplitHeaderRight>
    </>
  );
}
