import { DatePicker } from '@core/component/DatePicker';
import { formatDate } from '@core/util/dateParser';
import ClockIcon from '@icon/regular/clock.svg';
import type { DateMentionDecoratorProps } from '@lexical-core';
import { $isDateMentionNode } from '@lexical-core';
import { differenceInCalendarDays } from 'date-fns';
import {
  $getNodeByKey,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { createMemo, createSignal, Show, useContext } from 'solid-js';
import { Portal } from 'solid-js/web';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { floatWithElement } from '../../directive/floatWithElement';
import { autoRegister } from '../../plugins';
import { MentionTooltip } from './MentionTooltip';

false && floatWithElement;

function formatRelativeDate(date: Date): string {
  const diff = differenceInCalendarDays(date, new Date());
  switch (diff) {
    case -2:
      return '2 days ago';
    case -1:
      return 'Yesterday';
    case 0:
      return 'Today';
    case 1:
      return 'Tomorrow';
    case 2:
      return 'In 2 days';
    default:
      return formatDate(date);
  }
}

function formatTooltipDate(date: Date): string {
  const diff = Math.abs(differenceInCalendarDays(date, new Date()));
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  };
  if (diff <= 5) {
    options.hour = 'numeric';
    options.minute = '2-digit';
    options.hour12 = true;
  }
  return date.toLocaleDateString('en-US', options);
}

export function DateMention(props: DateMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;

  const [datePickerOpen, setDatePickerOpen] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  let mentionRef!: HTMLSpanElement;

  const displayFormat = createMemo(() => {
    return formatRelativeDate(new Date(props.date));
  });

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const handleDateChange = (newDate: Date) => {
    const editor = lexicalWrapper?.editor;
    if (!editor) return;

    editor.update(() => {
      const node = $getNodeByKey(props.key);
      if ($isDateMentionNode(node)) {
        node.setDate(newDate.toISOString());
        node.setDisplayFormat(formatRelativeDate(newDate));
      }
    });

    setDatePickerOpen(false);
  };

  if (editor) {
    autoRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        () => {
          if (isSelectedAsNode()) {
            setDatePickerOpen(true);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      editor.registerUpdateListener(() => {
        if (!isSelectedAsNode()) {
          setDatePickerOpen(false);
        }
      })
    );
  }

  const currentDate = () => new Date(props.date);

  return (
    <>
      <span
        ref={mentionRef}
        class="relative p-0.5 rounded-xs bg-accent/8 hover:bg-accent/20 focus:bg-accent/20 text-accent cursor-default"
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
            {formatTooltipDate(new Date(props.date))}
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
