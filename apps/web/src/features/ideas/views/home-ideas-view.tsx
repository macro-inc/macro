import { t } from '@app/lib/i18n';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { PriorityRow } from '../components/priority-row';
import { TodayTimeline } from '../components/today-timeline';
import type { DayEvent, DayStrip } from '../core/day';
import { type Idea, ideaStatus } from '../core/idea';

/**
 * Home, below the composer: today's calendar as a quiet strip, when there is
 * one, and the ideas that matter most. Each row opens For you on its idea.
 */
export function HomeIdeasView(props: {
  /** Undefined without a calendar. */
  today?: { date: Date; strip: DayStrip };
  priorities: Idea[];
  onOpenEvent(event: DayEvent): void;
  onOpenIdea(idea: Idea): void;
  onOpenAll(): void;
}) {
  return (
    <div class="flex flex-col gap-8 pt-10" data-home-ideas>
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
        <section aria-label={t('ideas.topPriorities')}>
          <div class="mb-2 flex items-center justify-between gap-4 px-1">
            <h2 class="text-sm font-medium text-ink">
              {t('ideas.topPriorities')}
            </h2>
            <Button variant="ghost" size="sm" onClick={props.onOpenAll}>
              {t('ideas.allInForYou')}
              <ArrowRightIcon class="size-3.5" />
            </Button>
          </div>
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            <For each={props.priorities}>
              {(idea) => (
                <PriorityRow
                  idea={idea}
                  status={ideaStatus(idea)}
                  onOpen={() => props.onOpenIdea(idea)}
                />
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}
