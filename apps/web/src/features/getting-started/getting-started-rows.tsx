import ChevronDownIcon from '@phosphor/caret-down.svg';
import CheckCircleIcon from '@phosphor/check-circle.svg';
import { cn, InlineCheckbox } from '@ui';
import { Show } from 'solid-js';
import type {
  GettingStartedAction,
  GettingStartedSection,
} from './getting-started-types';

/**
 * One activating action in the shared home-row style (icon + title, full
 * width), with a trailing checkbox that fills once the action completes. Rows
 * stay clickable when complete.
 *
 * `action.description` is deliberately not rendered for now — we're trying
 * title-only rows. The copy is kept on the action data so it can come back.
 */
export function ActionRow(props: {
  action: GettingStartedAction;
  complete: boolean;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      class="group flex w-full items-center gap-3.5 rounded-xl border border-edge-muted bg-active px-4 py-3 text-left transition-colors hover:bg-hover"
      onClick={props.onActivate}
    >
      <span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-muted">
        <props.action.icon class="size-4" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-ink">{props.action.title}</div>
      </div>
      <InlineCheckbox checked={props.complete} />
    </button>
  );
}

/**
 * Section header: title, an `x/n completed` counter that becomes a check mark
 * once every action is done, and a chevron collapse toggle (the whole header
 * toggles).
 */
export function SectionHeader(props: {
  section: GettingStartedSection;
  collapsed: boolean;
  completed: number;
  total: number;
  onToggle: () => void;
}) {
  const allComplete = () => props.total > 0 && props.completed >= props.total;
  return (
    <button
      type="button"
      class="group flex w-full items-center justify-between gap-3 px-1 text-left"
      aria-expanded={!props.collapsed}
      onClick={props.onToggle}
    >
      <div class="min-w-0 truncate text-sm font-medium text-ink">
        {props.section.title}
      </div>
      <span class="flex shrink-0 items-center gap-2">
        <Show
          when={allComplete()}
          fallback={
            <span class="text-xs tabular-nums text-ink-extra-muted">
              {props.completed}/{props.total}
            </span>
          }
        >
          <CheckCircleIcon class="size-4 text-accent" />
        </Show>
        <ChevronDownIcon
          class={cn(
            'size-4 shrink-0 text-ink-extra-muted transition-transform',
            props.collapsed && '-rotate-90'
          )}
        />
      </span>
    </button>
  );
}
