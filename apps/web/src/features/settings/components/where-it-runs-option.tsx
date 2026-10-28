import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';

/**
 * One place an agent can run. The selected option opens its own settings
 * (harness, model) inside the card; an unavailable one offers its setup
 * action instead of a radio that cannot be chosen.
 */
export function WhereItRunsOption(props: {
  value: string;
  title: string;
  description: string;
  icon: JSX.Element;
  checked: boolean;
  disabled?: boolean;
  /** Shown beside an unavailable option, e.g. Connect or Set up. */
  action?: JSX.Element;
  onSelect: () => void;
  /** Settings for the selected option. */
  children?: JSX.Element;
}) {
  return (
    <div
      class={cn(
        'min-w-0 rounded-lg border',
        props.checked ? 'border-accent bg-accent-bg' : 'border-edge-muted'
      )}
    >
      <div class="flex min-w-0 items-center gap-3 pr-3">
        <label
          class={cn(
            'flex min-w-0 flex-1 items-center gap-3 p-3',
            props.disabled && 'opacity-75'
          )}
        >
          <input
            type="radio"
            name="agent-where"
            value={props.value}
            checked={props.checked}
            disabled={props.disabled}
            onChange={props.onSelect}
            aria-label={props.title}
            class="shrink-0 accent-accent disabled:opacity-40"
          />
          <span
            aria-hidden="true"
            class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink/4 text-ink-muted [&_svg]:size-4"
          >
            {props.icon}
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-medium text-ink">
              {props.title}
            </span>
            <span class="mt-0.5 block text-xs text-ink-muted">
              {props.description}
            </span>
          </span>
        </label>
        <Show when={props.action}>
          <div class="shrink-0">{props.action}</div>
        </Show>
      </div>
      <Show when={props.checked && props.children}>
        <div class="px-3 pb-3 @min-[440px]:pl-[52px]">
          <div class="border-t border-ink/8 pt-3">{props.children}</div>
        </div>
      </Show>
    </div>
  );
}
