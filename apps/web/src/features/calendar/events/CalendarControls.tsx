import { Checkbox } from '@ui';
import { For } from 'solid-js';
import type { CalendarSource } from './types';

interface CalendarControlsProps {
  sources: CalendarSource[];
  isVisible: (sourceId: string) => boolean;
  onVisibilityChange: (sourceId: string, visible: boolean) => void;
}

/** Controls which calendar sources are visible in the calendar. */
export function CalendarControls(props: CalendarControlsProps) {
  return (
    <div class="flex flex-col gap-0.5">
      <For each={props.sources}>
        {(source) => (
          <Checkbox
            as="label"
            checked={props.isVisible(source.id)}
            onChange={(checked) => props.onVisibilityChange(source.id, checked)}
            class="flex w-full items-center rounded-lg px-2 py-1.5 text-xs text-ink hover:bg-hover"
          >
            <span
              aria-hidden="true"
              class="size-2.5 shrink-0 rounded-sm"
              style={{ 'background-color': source.color }}
            />
            <span class="min-w-0 flex-1 truncate">{source.name}</span>
            <Checkbox.Control />
          </Checkbox>
        )}
      </For>
    </div>
  );
}
