import { formatLocale, t } from '@app/lib/i18n';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn } from '@ui';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { surfaceLook } from '../../routines/components/routine-template-strip';
import type { RoutineSurface } from '../core/surfaces';

/**
 * The card at the top of a view sidebar: the first few suggestions' icons in
 * an overlapping stack, how many there are and their names, inside a border
 * that blends from violet to blue around the whole card. The whole card
 * opens the suggestions; on hover its close button takes the caret's place,
 * like the other sidebar cards' close buttons.
 */
export function RoutineSuggestionsCard(props: {
  count: number;
  /** The suggestions' names, first first. */
  titles: readonly string[];
  /** Up to three icons' parts of the app, first on top. */
  looks: readonly RoutineSurface[];
  /** Names the surface in the close button, e.g. "Email". */
  surfaceLabel: string;
  onOpen(trigger: HTMLButtonElement): void;
  onDismiss(): void;
  class?: string;
}) {
  const names = () =>
    new Intl.ListFormat(formatLocale(), {
      style: 'short',
      type: 'unit',
    }).format(props.titles);
  const hideLabel = () =>
    t('routineSuggestions.hideCard', { surface: props.surfaceLabel });
  return (
    <div
      class={cn(
        'group/routine-card relative min-w-0 shrink-0 [--routine-card-accent:45%] [--routine-card-hover:transparent] [--routine-card-violet:75%] not-touch:hover:[--routine-card-accent:55%] not-touch:hover:[--routine-card-hover:var(--color-hover)] not-touch:hover:[--routine-card-violet:90%]',
        props.class
      )}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        class="flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-transparent py-2.5 pr-2.5 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
        style={{
          background: [
            'linear-gradient(var(--routine-card-hover), var(--routine-card-hover)) padding-box',
            'linear-gradient(var(--color-control), var(--color-control)) padding-box',
            'linear-gradient(120deg, color-mix(in oklch, var(--color-violet) var(--routine-card-violet), transparent), color-mix(in oklch, var(--color-accent) var(--routine-card-accent), transparent)) border-box',
          ].join(', '),
        }}
        onClick={(event) => props.onOpen(event.currentTarget)}
      >
        <span class="isolate flex shrink-0 items-center" aria-hidden="true">
          <For each={props.looks}>
            {(look, index) => (
              <span
                class="flex size-[18px] items-center justify-center rounded-full bg-surface-3 shadow-[0_0_0_1.5px_var(--color-control)] not-first:-ml-[5px]"
                style={{ 'z-index': props.looks.length - index() }}
              >
                <Dynamic
                  component={surfaceLook(look).icon}
                  class={cn('size-2.5', surfaceLook(look).tint)}
                />
              </span>
            )}
          </For>
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate text-sm font-medium text-ink">
            {t('routineSuggestions.cardTitle', { count: props.count })}
          </span>
          <span class="truncate text-xs text-ink-muted">{names()}</span>
        </span>
        <CaretRightIcon
          class="size-3.5 shrink-0 text-ink-extra-muted not-touch:group-hover/routine-card:opacity-0 not-touch:group-has-[[data-card-dismiss]:focus-visible]/routine-card:opacity-0"
          aria-hidden="true"
        />
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        data-card-dismiss
        aria-label={hideLabel()}
        tooltip={hideLabel()}
        class="absolute top-1/2 right-1.5 -translate-y-1/2 not-touch:opacity-0 not-touch:group-hover/routine-card:opacity-100 not-touch:focus-visible:opacity-100"
        onClick={() => props.onDismiss()}
      >
        <XIcon class="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
