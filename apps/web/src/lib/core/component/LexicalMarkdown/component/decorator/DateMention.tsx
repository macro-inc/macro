import { DatePicker } from '@core/component/DatePicker';
import {
  formatMentionLabel,
  formatRelativeDay,
  formatTooltipDate,
  parseMentionDate,
} from '@core/util/dateParser';
import ClockIcon from '@icon/system/regular/clock.svg';
import type { DateMentionDecoratorProps } from '@macro-inc/lexical-core';
import { $isDateMentionNode } from '@macro-inc/lexical-core';
import {
  $getNodeByKey,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { createMemo, createSignal, Show, useContext } from 'solid-js';
import { Portal } from 'solid-js/web';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import type { DateMentionHostProp } from '../../decorator-host/date-mention-host';
import { floatWithElement } from '../../directive/floatWithElement';
import { autoRegister } from '../../plugins';
import { MentionTooltip } from './MentionTooltip';

false && floatWithElement;

/**
 * Source `importJSON` and `exportComponentProps` hand stored values over
 * unchanged, so null or omitted fields reach this component. The shared
 * formatter reads both fields and preserves the day fallback for absent labels.
 */
export type DateMentionUIProps = Omit<
  DateMentionDecoratorProps,
  'date' | 'displayFormat'
> & {
  date?: string | null;
  displayFormat?: string | null;
  mentionUuid?: string | null;
} & DateMentionHostProp;

export function DateMention(props: DateMentionUIProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;

  const [datePickerOpen, setDatePickerOpen] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  let mentionRef!: HTMLSpanElement;

  const displayFormat = createMemo(() =>
    formatMentionLabel(props.date, props.displayFormat)
  );

  const isSelectedAsNode = () => {
    if (props.host) return props.host.isSelected(props.key);
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const handleDateChange = (newDate: Date) => {
    if (props.host) {
      props.host.setDate(
        props.key,
        newDate.toISOString(),
        formatRelativeDay(newDate)
      );
      setDatePickerOpen(false);
      return;
    }
    const editor = lexicalWrapper?.editor;
    if (!editor) return;

    editor.update(() => {
      const node = $getNodeByKey(props.key);
      if ($isDateMentionNode(node)) {
        node.setDate(newDate.toISOString());
        node.setDisplayFormat(formatRelativeDay(newDate));
      }
    });

    setDatePickerOpen(false);
  };

  const onEnter = () => {
    if (isSelectedAsNode()) {
      setDatePickerOpen(true);
      return true;
    }
    return false;
  };
  const onUpdate = () => {
    if (!isSelectedAsNode()) {
      setDatePickerOpen(false);
    }
  };
  if (props.host) {
    autoRegister(
      props.host.registerNormalEnter(onEnter),
      props.host.registerUpdateListener(onUpdate)
    );
  } else if (editor) {
    autoRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        onEnter,
        COMMAND_PRIORITY_NORMAL
      ),
      editor.registerUpdateListener(onUpdate)
    );
  }

  const currentDate = () => parseMentionDate(props.date);

  return (
    <>
      <span
        ref={mentionRef}
        class="relative p-0.5 rounded-md bg-accent/8 hover:bg-accent/20 focus:bg-accent/20 text-accent cursor-default"
        classList={{
          'bg-active': isSelectedAsNode(),
        }}
        onClick={() => setDatePickerOpen(true)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span class="relative top-[0.125em] size-[1em] inline-flex mx-0.5">
          <ClockIcon class="size-full" />
        </span>
        <span
          data-date={props.date}
          data-display-format={displayFormat()}
          data-date-mention="true"
        >
          {displayFormat()}
        </span>
        <MentionTooltip show={isSelectedAsNode()} text="Edit" />
      </span>

      <Show when={hovered() && !datePickerOpen()}>
        <Portal>
          <div
            class="absolute select-none z-tool-tip bg-surface p-1.5 text-ink-muted text-xs wrap-break-word rounded-sm border border-edge-muted shadow-md shadow-[#000]/5"
            use:floatWithElement={{ element: () => mentionRef }}
          >
            {formatTooltipDate(parseMentionDate(props.date))}
          </div>
        </Portal>
      </Show>

      <Show when={datePickerOpen()}>
        <Portal>
          <DatePicker
            value={currentDate()}
            onChange={handleDateChange}
            onClose={() => setDatePickerOpen(false)}
            anchorRef={mentionRef}
          />
        </Portal>
      </Show>
    </>
  );
}
