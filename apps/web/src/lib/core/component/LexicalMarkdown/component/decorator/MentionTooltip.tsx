import { Hotkey, Surface, tooltipClasses } from '@ui';
import { Show } from 'solid-js';

export function MentionTooltip(props: { show: boolean; text: string }) {
  return (
    <Show when={props.show}>
      <div class="pointer-events-none absolute top-full left-0 z-tool-tip mt-1 w-fit whitespace-pre select-none">
        <Surface class={tooltipClasses({ class: 'h-auto w-fit' })} depth={3}>
          <div class="flex flex-row items-center gap-2">
            <div class="text-xs">{props.text}</div>
            <Hotkey shortcut="enter" theme="subtle" />
          </div>
        </Surface>
      </div>
    </Show>
  );
}
