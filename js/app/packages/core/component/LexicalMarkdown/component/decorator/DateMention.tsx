import { DatePicker } from '@core/component/DatePicker';
import { formatDate } from '@core/util/dateParser';
import ClockIcon from '@icon/regular/clock.svg';
import type { DateMentionDecoratorProps } from '@lexical-core';
import { $isDateMentionNode } from '@lexical-core';
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

export function DateMention(props: DateMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;

  const [datePickerOpen, setDatePickerOpen] = createSignal(false);
  let mentionRef!: HTMLSpanElement;

  const displayFormat = createMemo(() => {
    const date = new Date(props.date);
    return formatDate(date);
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
        node.setDisplayFormat(formatDate(newDate));
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
        class="relative py-0.5 px-0.5 rounded-xs bg-accent/8 hover:bg-accent/20 focus:bg-accent/20 text-accent-ink cursor-default"
        classList={{
          'bracket-offset-2': isSelectedAsNode(),
        }}
        onClick={() => setDatePickerOpen(true)}
      >
        <span class="relative top-[0.125em] size-[1em] inline-flex mx-0.5">
          <ClockIcon class="w-full h-full" />
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
