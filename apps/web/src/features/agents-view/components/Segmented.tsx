import LockIcon from '@phosphor/lock-simple.svg';
import TeamIcon from '@phosphor/users-three.svg';
import { For, Show } from 'solid-js';

type SegmentIcon = 'lock' | 'team';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: SegmentIcon;
  disabled?: boolean;
};

/** The design's compact segmented control (`.segc`): one pressed segment. */
export function Segmented<T extends string>(props: {
  name: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  large?: boolean;
}) {
  return (
    <span
      class={props.large ? 'segc lg' : 'segc'}
      data-seg={props.name}
      role="radiogroup"
      aria-label={props.name}
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === option.value}
            aria-pressed={props.value === option.value}
            disabled={option.disabled}
            title={option.disabled ? 'Create or join a team first' : undefined}
            onClick={() => props.onChange(option.value)}
          >
            <Show when={option.icon === 'lock'}>
              <LockIcon class="ph" />
            </Show>
            <Show when={option.icon === 'team'}>
              <TeamIcon class="ph" />
            </Show>
            {option.label}
          </button>
        )}
      </For>
    </span>
  );
}
