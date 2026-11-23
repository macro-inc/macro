import type { TimeOption } from '@app/components/date-time-range/time-options';
import { formatLocale } from '@app/lib/i18n';
import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import CheckIcon from '@icon/system/regular/check.svg';
import { cn, Dropdown } from '@ui';
import { addDays } from 'date-fns';
import { For, Show } from 'solid-js';
import { whenDateLabel } from '../../../core/when-summary';

export function WhenTimeOptions(props: {
  id: string;
  label: string;
  date: string;
  options: TimeOption[];
  selectedId: string;
  highlightedId?: string;
  inline: boolean;
  onChoose: (option: TimeOption) => void;
  ref: (element: HTMLDivElement) => void;
}) {
  const dayLabel = (offset: number) => {
    const date = parseLocalDate(props.date.slice(0, 10));
    return date
      ? whenDateLabel(formatLocalDate(addDays(date, offset)), formatLocale())
      : '';
  };
  return (
    <div
      ref={props.ref}
      id={props.id}
      role="listbox"
      aria-label={props.label}
      class={
        props.inline
          ? 'h-[220px] overflow-y-auto overscroll-auto'
          : 'max-h-56 overflow-y-auto py-1'
      }
    >
      <For each={props.options}>
        {(option, index) => (
          <>
            <Show
              when={
                !props.inline &&
                option.dayOffset > 0 &&
                props.options[index() - 1]?.dayOffset !== option.dayOffset
              }
            >
              <div class="px-3 py-1 text-xs text-ink-extra-muted">
                {dayLabel(option.dayOffset)}
              </div>
            </Show>
            <Dropdown.ItemFrame
              role="option"
              aria-selected={option.id === props.selectedId}
              data-highlighted={
                option.id === props.highlightedId ? '' : undefined
              }
              class={cn(
                'flex items-center justify-between gap-3',
                props.inline && 'h-11 rounded-[20px] px-3 text-base',
                option.id === props.selectedId && 'bg-selected! text-accent'
              )}
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onChoose(option)}
            >
              <Show when={props.inline}>
                <span class="w-[30px] shrink-0" />
              </Show>
              <span class="flex-1">
                {option.label.replace(/(\d)(am|pm)$/, '$1 $2')}
              </span>
              <Show when={option.detail}>
                <span class="text-ink-extra-muted">{option.detail}</span>
              </Show>
              <span class="w-4 shrink-0">
                <Show when={option.id === props.selectedId}>
                  <CheckIcon class="size-4 text-accent" />
                </Show>
              </span>
            </Dropdown.ItemFrame>
          </>
        )}
      </For>
    </div>
  );
}
