import type { DateTimeRangeValue } from '@app/components/date-time-range/time-range';
import type { EventVisibility } from '@service-calendar/generated/schemas/eventVisibility';
import type { Accessor } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { EventEditorSubmitValues } from '../components/composer/event-form-model';
import type {
  ComposerInitialMetadata,
  ComposerMetadataChanges,
} from '../core/composer-metadata';
import {
  isValidComposerTimeZone,
  withComposerTimeZone,
} from './composer-time-zone';

export function createComposerMetadata(options: {
  initial?: ComposerInitialMetadata;
  isEdit: boolean;
  timeZoneRelevant: Accessor<boolean>;
}) {
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const initialTimeZone = options.initial?.timeZone ?? localTimeZone;
  const initialVisibility =
    options.initial?.visibility ?? (options.isEdit ? undefined : 'default');
  const [state, setState] = createStore<{
    timeZone: string;
    visibility: EventVisibility | undefined;
  }>({
    timeZone: initialTimeZone,
    visibility: initialVisibility,
  });
  const timeZoneChanged = () =>
    options.timeZoneRelevant() && state.timeZone !== initialTimeZone;
  const visibilityChanged = () => state.visibility !== initialVisibility;
  return {
    state,
    isDirty: () => timeZoneChanged() || visibilityChanged(),
    setTimeZone: (timeZone: string) => {
      if (!isValidComposerTimeZone(timeZone)) return false;
      setState('timeZone', timeZone);
      return true;
    },
    setVisibility: (visibility: EventVisibility) =>
      setState('visibility', visibility),
    reset: () =>
      setState({ timeZone: initialTimeZone, visibility: initialVisibility }),
    resetVisibility: () => setState('visibility', initialVisibility),
    submission: (
      values: EventEditorSubmitValues,
      range: DateTimeRangeValue
    ) => {
      const changes: ComposerMetadataChanges = {};
      if (
        visibilityChanged() ||
        (!options.isEdit && state.visibility !== 'default')
      )
        changes.visibility = state.visibility;
      let time = values.time;
      const convertsWallClock =
        timeZoneChanged() || state.timeZone !== localTimeZone;
      if (convertsWallClock && time.kind === 'timed') {
        const converted = withComposerTimeZone(time, range, state.timeZone);
        if (!converted) return undefined;
        time = converted;
      }
      if (timeZoneChanged()) changes.timeZoneChanged = true;
      return {
        values: time === values.time ? values : { ...values, time },
        changes,
      };
    },
  };
}
