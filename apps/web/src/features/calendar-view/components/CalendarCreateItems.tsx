import { CreateMenuItem } from '@app/components/view-shell/CreateMenuItem';
import { useQuickCallsFlag } from '@app/features/meetings/use-quick-calls-flag';
import {
  bookingLinksSearch,
  bookingLinksSearchCodec,
} from '@app/features/scheduling/booking-links-search';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { useNavigate as useSplitNavigate } from '@app/lib/split-router';
import { bookingLinksRoute } from '@app/routes/routes';
import { enableCalendarScheduling } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import { useNavigate } from '@solidjs/router';
import { Show } from 'solid-js';
import { useOpenEventComposer } from './use-open-event-composer';

type CreateItemProps = { onSelect?: () => void };

export function CalendarCreateEventItem(props: CreateItemProps) {
  const openEventComposer = useOpenEventComposer();

  return (
    <CreateMenuItem
      icon={CalendarIcon}
      title={t('create.eventLabel')}
      description={t('create.guideEvent')}
      closeOnSelect
      onSelect={() => {
        props.onSelect?.();
        fireAndForget(openEventComposer(), 'calendar');
      }}
    />
  );
}

export function CalendarCreateCallItem(props: CreateItemProps) {
  const quickCalls = useQuickCallsFlag();
  const navigate = useNavigate();

  return (
    <Show when={quickCalls().enabled}>
      <CreateMenuItem
        icon={PhoneIcon}
        title={t('create.callLabel')}
        description={t('create.guideCall')}
        closeOnSelect
        onSelect={() => {
          props.onSelect?.();
          navigate('/meet/new');
        }}
      />
    </Show>
  );
}

export function CalendarCreateBookingLinkItem(props: CreateItemProps) {
  const navigate = useSplitNavigate();

  return (
    <ShowFeatureFlag flag={enableCalendarScheduling}>
      <CreateMenuItem
        icon={LinkIcon}
        title={t('create.bookingLinkLabel')}
        description={t('create.guideBookingLink')}
        closeOnSelect
        onSelect={() => {
          props.onSelect?.();
          fireAndForget(
            navigate(
              { route: bookingLinksRoute },
              {
                search: {
                  [bookingLinksSearch.namespace]:
                    bookingLinksSearchCodec.serialize({
                      ...bookingLinksSearch.defaults,
                      createBookingLink: true,
                    }),
                },
              }
            ),
            'scheduling'
          );
        }}
      />
    </ShowFeatureFlag>
  );
}
