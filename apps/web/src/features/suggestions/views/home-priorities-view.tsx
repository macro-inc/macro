import { t } from '@app/lib/i18n';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { PriorityRow } from '../components/priority-row';
import { TodayTimeline } from '../components/today-timeline';
import type { DayEvent, DayStrip } from '../core/day';
import type { Suggestion } from '../core/suggestion';

/**
 * Home, below the composer: today's calendar as a quiet strip, when there is
 * one, and the suggestions that matter most. Each row opens For you on its suggestion.
 */
export function HomePrioritiesView(props: {
  /** Undefined without a calendar. */
  today?: { date: Date; strip: DayStrip };
  priorities: Suggestion[];
  onOpenEvent(event: DayEvent): void;
  onOpenSuggestion(suggestion: Suggestion): void;
  onOpenAll(): void;
}) {
  return (
    <div class="flex flex-col gap-8 pt-10" data-home-priorities>
      <Show when={props.today} keyed>
        {(today) => (
          <TodayTimeline
            date={today.date}
            strip={today.strip}
            onOpen={props.onOpenEvent}
          />
        )}
      </Show>
      <Show when={props.priorities.length > 0}>
        <section aria-label={t('suggestions.topPriorities')}>
          <div class="mb-2 flex items-center justify-between gap-4 px-1">
            <h2 class="text-sm font-medium text-ink">
              {t('suggestions.topPriorities')}
            </h2>
            <Button variant="ghost" size="sm" onClick={props.onOpenAll}>
              {t('suggestions.allInForYou')}
              <ArrowRightIcon class="size-3.5" />
            </Button>
          </div>
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            <For each={props.priorities}>
              {(suggestion) => (
                <PriorityRow
                  suggestion={suggestion}
                  onOpen={() => props.onOpenSuggestion(suggestion)}
                />
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}
