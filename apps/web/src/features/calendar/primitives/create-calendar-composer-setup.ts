import { mergeProps } from 'solid-js';
import {
  type CalendarEventFormController,
  type CreateCalendarEventFormControllerOptions,
  createCalendarEventFormController,
} from '../components/composer/create-calendar-event-form-controller';
import type { CalendarComposerOptions } from '../core/composer';
import { createCalendarComposer } from './create-calendar-composer';

export type ComposerSetupSource = {
  form: CreateCalendarEventFormControllerOptions;
};
/** Shared controller/model assembly; each host supplies its own transport and lifecycle. */
export function createCalendarComposerSetup(
  source: ComposerSetupSource,
  options: (
    controller: CalendarEventFormController
  ) => Omit<CalendarComposerOptions, 'controller'>
) {
  const controller = createCalendarEventFormController(source.form);
  const model = createCalendarComposer(
    mergeProps({ controller }, options(controller))
  );
  return { controller, model };
}
