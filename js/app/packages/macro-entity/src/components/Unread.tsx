import FilledCircle from '@phosphor-icons/core/assets/fill/circle-fill.svg';
import Circle from '@phosphor-icons/core/assets/regular/circle.svg';
import { ToggleSwitch } from 'core/component/FormControls/ToggleSwitch';
import { type JSX, Show } from 'solid-js';

export function UnreadIndicator(props: { active?: boolean }) {
  return (
    <div class="flex min-w-5 items-center justify-center">
      <FilledCircle
        classList={{
          'flex size-3 text-accent': true,
          invisible: !props.active,
        }}
      />
    </div>
  );
}

export function UnreadCheckbox(props: {
  checked?: boolean;
  onChange?: JSX.ChangeEventHandlerUnion<HTMLInputElement, Event>;
}) {
  return (
    <div
      class="hover-transition-bg relative flex h-8 flex-row items-center gap-1 px-2.5 py-1 hover:bg-hover has-checked:bg-accent/20 sm:gap-2.5"
      tabindex={1}
    >
      <div class="flex min-w-5 items-center justify-center">
        <Show
          when={props.checked}
          fallback={<Circle class="flex size-3 text-accent" />}
        >
          <FilledCircle class="flex size-3 text-accent" />
        </Show>
      </div>
      <label class="has-checked:text-accent">
        <input
          class="group absolute inset-0 appearance-none"
          type="checkbox"
          checked={props.checked}
          onChange={props.onChange}
        />
        Unread
      </label>
    </div>
  );
}

export function UnreadSwitch(props: {
  checked?: boolean;
  onChange?: (isChecked: boolean) => void;
}) {
  return (
    <div class="flex h-8 flex-row items-center gap-1 px-2.5 py-1 sm:gap-2.5">
      <div class="flex min-w-5 items-center justify-center">
        <Show
          when={props.checked}
          fallback={<Circle class="flex size-3 text-accent" />}
        >
          <FilledCircle class="flex size-3 text-accent" />
        </Show>
      </div>
      <ToggleSwitch {...props} label="Unread" />
    </div>
  );
}
