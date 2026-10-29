import {
  newScheduleTrigger,
  type RoutineEventName,
  type RoutineTriggerDraft,
} from '@app/features/routines/core/routine-triggers';
import { describeCron } from '@core/util/cron';
import type { RoutineSuggestion as WireSuggestion } from '@service-cognition/generated/schemas/routineSuggestion';
import type { SuggestedEvent } from '@service-cognition/generated/schemas/suggestedEvent';
import type { SuggestionSchedule } from '@service-cognition/generated/schemas/suggestionSchedule';
import type { SuggestionTrigger } from '@service-cognition/generated/schemas/suggestionTrigger';
import type { Weekday } from '@service-cognition/generated/schemas/weekday';
import { match } from 'ts-pattern';
import type { RoutineSuggestion } from '../core/suggestions';

export type { WireSuggestion };

const EVENT_LABELS = {
  'email.message_received': 'When a new email arrives',
  'task.created': 'When a task is created',
  'document.created': 'When a document is created',
  'call.started': 'When a call starts',
  'call.ended': 'When a call ends',
} satisfies Record<SuggestedEvent & RoutineEventName, string>;

const CRON_WEEKDAYS: Record<Weekday, string> = {
  sun: '1',
  mon: '2',
  tue: '3',
  wed: '4',
  thu: '5',
  fri: '6',
  sat: '7',
};

const EVERY_DAY = ['1', '2', '3', '4', '5', '6', '7'];

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function scheduleTrigger(
  schedule: SuggestionSchedule,
  timezone: string
): { trigger: RoutineTriggerDraft; when: string } | undefined {
  return match(schedule)
    .with({ frequency: 'hour' }, () => ({
      trigger: { ...newScheduleTrigger('hour'), timezone },
      when: 'Every hour',
    }))
    .with({ frequency: 'day' }, ({ time }) => ({
      trigger: {
        ...newScheduleTrigger('week'),
        time,
        daysOfWeek: EVERY_DAY,
        timezone,
      },
      when: capitalize(
        describeCron({
          frequency: 'week',
          time,
          daysOfWeek: EVERY_DAY,
          dayOfMonth: '1',
        })
      ),
    }))
    .with({ frequency: 'week' }, ({ time, weekdays }) => {
      const daysOfWeek = weekdays.map((day) => CRON_WEEKDAYS[day]);
      return {
        trigger: { ...newScheduleTrigger('week'), time, daysOfWeek, timezone },
        when: capitalize(
          describeCron({ frequency: 'week', time, daysOfWeek, dayOfMonth: '1' })
        ),
      };
    })
    .with({ frequency: 'month' }, ({ time, dayOfMonth }) => {
      const day = String(dayOfMonth);
      return {
        trigger: {
          ...newScheduleTrigger('month'),
          time,
          dayOfMonth: day,
          timezone,
        },
        when: capitalize(
          describeCron({
            frequency: 'month',
            time,
            daysOfWeek: [],
            dayOfMonth: day,
          })
        ),
      };
    })
    .exhaustive(() => undefined);
}

function routineTrigger(
  trigger: SuggestionTrigger,
  timezone: string
): { trigger: RoutineTriggerDraft; when: string } | undefined {
  return match(trigger)
    .with({ kind: 'event' }, ({ event, condition }) => ({
      trigger: {
        id: crypto.randomUUID(),
        kind: 'event' as const,
        events: [event],
        ...(condition ? { condition } : {}),
      },
      when: EVENT_LABELS[event],
    }))
    .with({ kind: 'schedule' }, ({ schedule }) =>
      scheduleTrigger(schedule, timezone)
    )
    .exhaustive(() => undefined);
}

/**
 * The server's suggestions as the UI shows them, with triggers in the
 * routine composer's shape and scheduled in `timezone`. The server has
 * already validated them; one in a shape this build does not know (a newer
 * server) is skipped.
 */
export function toRoutineSuggestions(
  suggestions: readonly WireSuggestion[],
  timezone: string
): RoutineSuggestion[] {
  return suggestions.flatMap((suggestion) => {
    const trigger = routineTrigger(suggestion.trigger, timezone);
    if (!trigger) return [];
    return [
      {
        id: JSON.stringify([
          suggestion.surface,
          suggestion.title.toLowerCase(),
        ]),
        surface: suggestion.surface,
        title: suggestion.title,
        summary: suggestion.summary,
        reason: suggestion.reason,
        instructions: suggestion.instructions,
        icon: suggestion.icon,
        keepProbability: suggestion.keepProbability,
        affectsOthers: suggestion.affectsOthers,
        notify: suggestion.notify,
        ...trigger,
      },
    ];
  });
}
