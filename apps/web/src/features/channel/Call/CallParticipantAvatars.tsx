import { UserIcon } from '@core/component/UserIcon';
import { For, Show } from 'solid-js';

/** Keep four avatar slots; the overflow slot represents everyone after the first three. */
export function CallParticipantAvatars(props: { ids: readonly string[] }) {
  return (
    <For each={props.ids.slice(0, 4)}>
      {(id, index) => (
        <div class="relative size-14 shrink-0">
          <UserIcon
            id={id}
            size="lg"
            class="size-14"
            suppressClick
            showTooltip={false}
          />
          <Show when={index() === 3 && props.ids.length > 4}>
            <span class="absolute inset-0 flex items-center justify-center rounded-full bg-surface/85 text-lg font-semibold text-ink backdrop-blur-xs">
              +{props.ids.length - 3}
            </span>
          </Show>
        </div>
      )}
    </For>
  );
}
