import type { JSX } from 'solid-js';
import { CalendarComposerEditor } from '../../CalendarComposerEditor';
import type { EventEditorInitialValues } from '../../components/composer/event-form-model';
import type { CreatedCalendarEvent } from '../../core/composer';
import type { CalendarEvent } from '../../types';

export interface StandaloneComposerProps {
  event?: CalendarEvent;
  initialValues?: EventEditorInitialValues;
  suggestedValues?: Promise<Partial<EventEditorInitialValues>>;
  initialDrawerHeight?: number;
  pinned?: boolean;
  onTogglePin?: () => void;
  onHeaderPointerDown?: JSX.EventHandler<HTMLDivElement, PointerEvent>;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCreated?: (created: CreatedCalendarEvent) => void;
  onSaved?: () => void;
  onClose: () => void;
}

/** Each mounted instance owns one draft; placement changes must not remount it. */
export function StandaloneComposer(props: StandaloneComposerProps) {
  return <CalendarComposerEditor {...props} macroCallsEnabled={() => true} />;
}
