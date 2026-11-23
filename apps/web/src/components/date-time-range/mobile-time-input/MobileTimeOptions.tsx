import { formatLocale } from '@app/lib/i18n';
import { parseLocalDate } from '@core/util/local-date';
import { Dropdown } from '@ui';
import { addDays } from 'date-fns';
import { createMemo, For, Show } from 'solid-js';
import type { TimeOption } from '../time-options';
import { MobileTimeOption } from './MobileTimeOption';

interface TimeGroup {
  offset: number;
  options: TimeOption[];
}

export function MobileTimeOptions(props: {
  id: string;
  label: string;
  date?: string;
  options: TimeOption[];
  selectedId: string;
  highlightedId?: string;
  onChoose: (option: TimeOption) => void;
  ref: (element: HTMLDivElement) => void;
}) {
  const groups = createMemo(() => {
    const groups: TimeGroup[] = [];
    for (const option of props.options) {
      let group = groups.at(-1);
      if (!group || group.offset !== option.dayOffset) {
        group = { offset: option.dayOffset, options: [] };
        groups.push(group);
      }
      group.options.push(option);
    }
    return groups;
  });
  const dateLabel = (offset: number) => {
    const date = props.date ? parseLocalDate(props.date) : undefined;
    if (!date) return undefined;
    return new Intl.DateTimeFormat(formatLocale(), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(addDays(date, offset));
  };
  return (
    <Dropdown.GroupFrame
      ref={props.ref}
      id={props.id}
      role="listbox"
      aria-label={props.label}
    >
      <For each={groups()}>
        {(group) => (
          <div role="group" aria-label={dateLabel(group.offset)}>
            <Show when={group.offset > 0 && dateLabel(group.offset)}>
              {(label) => (
                <div class="sticky top-0 z-10 flex min-h-7 items-center bg-menu px-3 text-xs text-ink-extra-muted">
                  {label()}
                </div>
              )}
            </Show>
            <For each={group.options}>
              {(option) => (
                <MobileTimeOption
                  id={`${props.id}-${option.id.replace('|', '-')}`}
                  option={option}
                  selected={option.id === props.selectedId}
                  highlighted={option.id === props.highlightedId}
                  onChoose={props.onChoose}
                />
              )}
            </For>
          </div>
        )}
      </For>
    </Dropdown.GroupFrame>
  );
}
