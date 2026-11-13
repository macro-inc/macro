import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { cn } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { For, type JSX, Show } from 'solid-js';

export type ActivityRowStep = {
  key: string;
  label: string;
  time: string;
};

export type ActivityRowProps = {
  name: string;
  icon: JSX.Element;
  /** The latest step, shown under the name. */
  latest: string;
  time: string;
  unseen: boolean;
  /** Oldest first. A row with one step has no timeline. */
  steps: ActivityRowStep[];
  expanded: boolean;
  /** Absent when the item can't be opened (no access, unknown kind). */
  onOpen?: (event: MouseEvent) => void;
  onToggle: () => void;
  ref?: (element: HTMLDivElement) => void;
};

/**
 * One item the agent changed: its name and latest step, and, when it has more
 * than one, a timeline of every step behind a count. The timeline's rail and
 * dots line up under the item's icon.
 */
export function ActivityRow(props: ActivityRowProps) {
  const multiple = () => props.steps.length > 1;
  const expanded = () => props.expanded && multiple();

  return (
    <div ref={props.ref} data-agent-activity-item class="rounded-lg">
      <div class="relative flex items-start gap-1 rounded-lg not-touch:hover:bg-hover not-touch:focus-within:bg-hover">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-accent touch:min-h-11 disabled:cursor-default"
          disabled={!props.onOpen}
          onClick={(event) => props.onOpen?.(event)}
        >
          <span class="flex h-4.5 shrink-0 items-center">{props.icon}</span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-[13px] leading-[18px] font-medium text-ink">
              {props.name}
            </span>
            <span
              class={cn(
                'flex min-w-0 gap-1.5 text-[11.5px] leading-4 text-ink-subtle',
                multiple() && 'pr-9 touch:pr-0'
              )}
            >
              <span class="min-w-0 truncate">{props.latest}</span>
              <span class="hidden shrink-0 tabular-nums touch:inline">
                {props.time}
              </span>
            </span>
          </span>
          <span class="flex h-4.5 shrink-0 items-center gap-1.5 text-[11.5px] tabular-nums text-ink-subtle">
            <Show when={props.unseen}>
              <span
                class="size-1.5 rounded-full bg-accent"
                role="img"
                aria-label={t('agentWork.unseenActivity')}
              />
            </Show>
            <span class="touch:hidden">{props.time}</span>
          </span>
        </button>
        <Show when={multiple()}>
          <button
            type="button"
            class="absolute right-1.5 bottom-1.5 flex h-4.5 items-center gap-0.5 rounded-md px-1 text-[11px] tabular-nums text-ink-subtle outline-none hover:bg-active hover:text-ink focus-visible:outline-2 focus-visible:outline-accent touch:static touch:h-9 touch:self-center touch:px-2"
            aria-expanded={expanded()}
            aria-label={t('agentWork.showEntityActivity', { name: props.name })}
            onClick={() => props.onToggle()}
          >
            <span class="font-medium">{props.steps.length}</span>
            <CaretDownIcon
              class={cn(
                'size-3 transition-transform duration-150 motion-reduce:transition-none',
                expanded() && 'rotate-180'
              )}
            />
          </button>
        </Show>
      </div>
      <Show when={multiple()}>
        <CollapseTransition open={expanded()}>
          <ol class="mt-0.5 mb-1.5 flex flex-col">
            <For each={props.steps}>
              {(step, index) => (
                <ActivityStep
                  label={step.label}
                  time={step.time}
                  first={index() === 0}
                  latest={index() === props.steps.length - 1}
                />
              )}
            </For>
          </ol>
        </CollapseTransition>
      </Show>
    </div>
  );
}

/** A timeline step on the rail under the row's icon; the latest dot is filled. */
function ActivityStep(props: {
  label: string;
  time: string;
  first: boolean;
  latest: boolean;
}) {
  return (
    <li class="relative flex min-h-6 items-center gap-2 pr-2 pl-8 text-[11.5px] leading-4 text-ink-subtle touch:min-h-9">
      <span
        aria-hidden="true"
        class={cn(
          'absolute left-[15.5px] w-px bg-ink-placeholder/45',
          props.first ? 'top-1/2' : 'top-0',
          props.latest ? 'bottom-1/2' : 'bottom-0'
        )}
      />
      <span
        aria-hidden="true"
        class={cn(
          'absolute top-1/2 left-[12.5px] size-[7px] -translate-y-1/2 rounded-full border-[1.5px]',
          props.latest
            ? 'border-ink-subtle bg-ink-subtle'
            : 'border-ink-placeholder bg-surface'
        )}
      />
      <span
        class={cn('min-w-0 flex-1 truncate', props.latest && 'text-ink-muted')}
      >
        {props.label}
      </span>
      <span class="shrink-0 tabular-nums">{props.time}</span>
    </li>
  );
}
