import type { CalendarUpdateScope } from '@service-email/client';
import type { CalendarEventFormController } from '../components/composer/create-calendar-event-form-controller';
import type {
  EventEditorDisabledFields,
  EventEditorSubmitValues,
} from '../components/composer/event-form-model';
import type { CalendarTimeFormat } from '../types';
import type {
  ComposerInitialMetadata,
  ComposerMetadataChanges,
} from './composer-metadata';

/** Host-owned data and actions for the new calendar composer, without UI slots. */
export interface CalendarComposerOptions {
  controller: CalendarEventFormController;
  pending: boolean;
  disabled?: boolean;
  isEdit?: boolean;
  timeFormat?: CalendarTimeFormat;
  initialMetadata?: ComposerInitialMetadata;
  disabledFields?: EventEditorDisabledFields;
  addOnlyGuests?: boolean;
  guestsReadOnlyReason?: string;
  guestListHidden?: boolean;
  guestPolicyEditable?: boolean;
  detailsReadOnlyReason?: string;
  showRecurringEditNotice?: boolean;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSubmit: (
    values: EventEditorSubmitValues,
    scope?: CalendarUpdateScope,
    metadata?: ComposerMetadataChanges
  ) => void;
}
