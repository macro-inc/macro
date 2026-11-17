import type { Accessor } from 'solid-js';
import type { EventEditorInitialValues } from '../components/composer/event-form-model';
import type { CalendarEvent } from '../types';
import type { CreatedCalendarEvent } from './composer';

export interface ComposerOpenRequest {
  event?: CalendarEvent;
  initialValues?: EventEditorInitialValues;
  suggestedValues?: Promise<Partial<EventEditorInitialValues>>;
  initialDrawerHeight?: number;
  anchorRect?: Accessor<DOMRectReadOnly | undefined>;
  returnFocus?: HTMLElement;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onCreated?: (created: CreatedCalendarEvent) => void;
  onClose?: () => void;
}
