import KeyReturn from '@icon/regular/arrow-elbow-down-left.svg';
import { Show } from 'solid-js';

export function MentionTooltip(props: { show: boolean; text: string }) {
  return (
    <Show when={props.show}>
      <div class="select-none pointer-events-none absolute z-action-menu top-full flex gap-1 left-0 mt-2 p-1 w-[fit-content] whitespace-pre text-panel bg-ink text-xs rounded-xs font-mono">
        <div class="h-4 w-6 text-panel flex flex-row">
          [<KeyReturn />]
        </div>
        {props.text}
      </div>
    </Show>
  );
}
