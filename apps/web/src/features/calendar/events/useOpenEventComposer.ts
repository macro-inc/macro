import { useSplitLayout } from '@components/app/split-layout/layout';
import { confirmDialog } from '@ui';
import { getOwner } from 'solid-js';
import type { EventEditorInitialValues } from './EventEditorForm';
import type { CalendarEvent } from './types';

/** Values and lifecycle callbacks used to open an event composer. */
export interface OpenEventComposerOptions {
  event?: CalendarEvent;
  initialValues?: EventEditorInitialValues;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onClose?: () => void;
}

/** Opens an event composer with confirmation before discarding a new event. */
export function useOpenEventComposer() {
  const { popoverSplit } = useSplitLayout();
  const owner = getOwner();

  return (options: OpenEventComposerOptions = {}) => {
    let eventSaved = false;
    let closeConfirmationPending = false;

    return popoverSplit(
      {
        type: 'component',
        id: 'calendar-event-compose',
        params: {
          event: options.event,
          initialValues: options.initialValues,
          onCalendarChange: options.onCalendarChange,
          onSaveSuccess: () => {
            eventSaved = true;
          },
        },
      },
      {
        onClose: async (close) => {
          if (closeConfirmationPending) return;

          if (!eventSaved) {
            closeConfirmationPending = true;
            try {
              const confirmed = await confirmDialog(
                {
                  title: 'You still have remaining changes',
                  body: 'Closing this event will discard your changes.',
                  confirmLabel: 'Discard',
                  cancelLabel: 'Keep editing',
                  tone: 'danger',
                },
                { owner }
              );
              if (!confirmed) return;
            } finally {
              closeConfirmationPending = false;
            }
          }

          options.onClose?.();
          close();
        },
      }
    );
  };
}
