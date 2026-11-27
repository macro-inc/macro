import { t } from '@app/lib/i18n';
import InfoIcon from '@icon/system/regular/info.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerNotices() {
  const model = useCalendarComposer();
  const providerDeclines = () =>
    model.controller.selectedCalendarOption()?.provider === 'outlook' &&
    model.state().outOfOffice?.autoDeclineMode !== 'decline_none';
  return (
    <>
      <Show when={model.options.detailsReadOnlyReason}>
        {(reason) => <p class="text-xs text-ink-muted">{reason()}</p>}
      </Show>
      <Show when={model.conferenceLocked()}>
        <Show
          when={model.conferenceRemovalPending()}
          fallback={
            <p class="text-xs text-ink-muted">
              {t('calendar.conferenceLocked')}
            </p>
          }
        >
          <div
            role="status"
            class="flex min-w-0 gap-3 rounded-lg border border-accent/30 bg-accent-bg p-3 text-xs text-ink"
          >
            <InfoIcon class="mt-px size-4 shrink-0 text-accent" />
            <div class="flex min-w-0 flex-col items-start gap-2.5">
              <p>{t('calendar.conferenceRemovalPending')}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={model.formIsDisabled()}
                onClick={model.undoConferenceRemoval}
              >
                {t('calendar.undoConferenceRemoval')}
              </Button>
            </div>
          </div>
        </Show>
      </Show>
      <Show when={model.controller.conferenceError()}>
        {(error) => (
          <p role="alert" class="text-xs text-warning">
            {error()}
          </p>
        )}
      </Show>
      <Show when={model.outOfOfficeNotice()}>
        {(notice) => (
          <div
            role="note"
            aria-label={t('calendar.eventKindOutOfOffice')}
            class="flex flex-col gap-1 rounded-lg border border-border-secondary bg-warning-bg p-3 text-xs text-warning-ink"
          >
            <span class="font-medium">
              {t('calendar.eventKindOutOfOffice')}
            </span>
            <span>{notice().effect}</span>
            <Show when={providerDeclines()}>
              <span>{t('calendar.providerDeclinesWarning')}</span>
            </Show>
            <Show when={notice().declineMessage}>
              {(message) => (
                <span class="italic">
                  {t('calendar.declineReply', { message: message() })}
                </span>
              )}
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}
