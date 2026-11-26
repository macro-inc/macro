import { useCalendarComposerHost } from '@app/features/calendar/context/calendar-composer-host-context';
import type { ComposerOpenRequest } from '@app/features/calendar/core/composer-session';
import { canEditCalendarEvent } from '@app/features/calendar/utils/event-interaction';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { confirmDialog } from '@ui';
import { getOwner } from 'solid-js';

/** Opens an event composer with confirmation before discarding changes. */
export function useOpenEventComposer() {
  const { popoverSplit } = useSplitLayout();
  const owner = getOwner();
  const host = useCalendarComposerHost();

  return (options: ComposerOpenRequest = {}) => {
    if (options.event && !canEditCalendarEvent(options.event)) return;
    if (host && !isTouchDevice()) {
      fireAndForget(host.open(options), 'calendar-composer-open');
      return;
    }
    let eventSaved = false;
    let formDirty = false;
    let closeConfirmationPending = false;

    return popoverSplit(
      {
        type: 'component',
        id: 'calendar-event-compose',
        params: {
          event: options.event,
          initialValues: options.initialValues,
          suggestedValues: options.suggestedValues,
          dayDraftRange: options.dayDraftRange,
          initialDrawerHeight: options.initialDrawerHeight,
          onCalendarChange: options.onCalendarChange,
          onDirtyChange: (dirty: boolean) => {
            formDirty = dirty;
          },
          onSaveSuccess: () => {
            eventSaved = true;
          },
          onCreated: options.onCreated,
        },
      },
      {
        onClose: async (close) => {
          if (closeConfirmationPending) return;

          if (!eventSaved && formDirty) {
            closeConfirmationPending = true;
            try {
              const confirmed = await confirmDialog(
                {
                  title: t('calendar.discardTitle'),
                  body: t('calendar.discardBody'),
                  confirmLabel: t('calendar.discard'),
                  cancelLabel: t('calendar.keepEditing'),
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
