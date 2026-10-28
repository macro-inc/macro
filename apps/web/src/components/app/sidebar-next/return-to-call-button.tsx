import { useActiveQuickCallsSource } from '@app/features/meetings/queries/active-quick-calls';
import { useQuickCallsFlag } from '@app/features/meetings/use-quick-calls-flag';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { useCallContextOptional } from '@channel/Call/CallContext';
import {
  getActiveMeetingPath,
  getMeetingShareToken,
} from '@channel/Call/call-link';
import { openChannelCallTab } from '@channel/Call/open-channel-call-tab';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import PhoneFillIcon from '@icon/system/fill/phone-fill.svg';
import { useNavigate } from '@solidjs/router';
import { Button, pressHandlers } from '@ui';
import { Show, Suspense } from 'solid-js';
import { NavGlyph } from './nav-glyph';

function ReturnToCallButtonContent() {
  const call = useCallContextOptional();
  const analytics = useAnalytics();
  const navigate = useNavigate();
  const userId = useUserId();
  const flag = useQuickCallsFlag();
  const quickCalls = useActiveQuickCallsSource(() =>
    !flag().loading && flag().enabled ? userId() : undefined
  );

  const inCall = () => Boolean(call?.isInCall());

  // A quick call is backed by a channel call; it lives on its meeting page.
  const meetingShareToken = () => {
    const callId = call?.activeCallId();
    if (!callId) return undefined;
    const meeting = quickCalls
      .calls()
      .find((quickCall) => quickCall.callId === callId);
    return meeting ? getMeetingShareToken(meeting.url) : undefined;
  };

  const open = (event: MouseEvent) => {
    event.preventDefault();
    analytics.track('sidebar_click', { view: 'active-call' });
    const token = meetingShareToken();
    if (token) {
      navigate(getActiveMeetingPath(token));
      return;
    }
    const channelId = call?.activeChannelId();
    if (channelId)
      fireAndForget(openChannelCallTab(channelId), 'sidebar-return-to-call');
  };

  return (
    <Show when={inCall()}>
      <Button
        variant="success"
        size="icon-md"
        class="size-10 cursor-default rounded-xl"
        label={t('nav.returnToCall')}
        tooltip={t('nav.returnToCall')}
        tooltipPlacement="right"
        draggable={false}
        data-sidebar-next-item="active-call"
        {...pressHandlers(open)}
      >
        <NavGlyph icon={PhoneFillIcon} class="size-5" />
      </Button>
    </Show>
  );
}

/** Green phone at the bottom of the rail, shown while the user is in a call. */
export const ReturnToCallButton = () => (
  <Show when={ENABLE_CALLS}>
    <Suspense>
      <ReturnToCallButtonContent />
    </Suspense>
  </Show>
);
