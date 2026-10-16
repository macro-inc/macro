import CalendarIcon from '@phosphor/calendar-blank.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { type AutoReloadBudget, formatCreditBalance } from '../core/usage';

/** Shared presentation; monthly facts must come from an authoritative source or an explicit fixture. */
export function AutoReloadLimitNotice(props: {
  budget: AutoReloadBudget;
  canManage: boolean;
  pending: boolean;
  onAdjust: (trigger: HTMLButtonElement) => void;
  onAddCredits: (trigger: HTMLButtonElement) => void;
}) {
  const resetDate = () =>
    new Date(props.budget.resetsAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  return (
    <div
      role="status"
      class="flex flex-col gap-3 rounded-xl border border-accent/20 bg-accent/5 p-4 text-left"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="flex min-w-0 items-start gap-2">
          <CalendarIcon class="mt-0.5 size-4 shrink-0 text-accent" />
          <p class="text-sm font-medium text-ink">
            Monthly auto-reload {formatCreditBalance(props.budget.limitCents)}{' '}
            limit reached
          </p>
        </div>
        <span class="shrink-0 pt-0.5 text-xs text-ink-muted">
          resets {resetDate()}
        </span>
      </div>
      <Show
        when={props.canManage}
        fallback={
          <p class="text-xs text-ink-muted">
            Ask your team owner to adjust the limit or add credits.
          </p>
        }
      >
        <div class="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            depth={3}
            disabled={props.pending}
            onClick={(event) => props.onAdjust(event.currentTarget)}
          >
            Adjust limit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            depth={3}
            disabled={props.pending}
            onClick={(event) => props.onAddCredits(event.currentTarget)}
          >
            Add credits
          </Button>
        </div>
      </Show>
    </div>
  );
}
