import { t } from '@app/lib/i18n';
import { Spinner } from '@ui';
import { Show } from 'solid-js';
import { useEventRsvp } from '../../context/event-rsvp-context';

export function EventRsvpStatus() {
  const response = useEventRsvp();
  return (
    <span role="status" class="size-4">
      <Show when={response.rsvp.pending()}>
        <Spinner size="sm" decorative />
        <span class="sr-only">{t('calendar.savingResponse')}</span>
      </Show>
    </span>
  );
}
