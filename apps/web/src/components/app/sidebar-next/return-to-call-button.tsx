import { useActiveQuickCallsSource } from '@app/features/meetings/queries/active-quick-calls';
import { useQuickCallsFlag } from '@app/features/meetings/use-quick-calls-flag';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { CallWaveform } from '@channel/Call/CallWaveform';
import {
  getActiveMeetingPath,
  getMeetingShareToken,
} from '@channel/Call/call-link';
import { openChannelCallTab } from '@channel/Call/open-channel-call-tab';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { lazyNamed } from '@core/util/lazyNamed';
import { Popover } from '@kobalte/core/popover';
import { useNavigate } from '@solidjs/router';
import { Button } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';

const ActiveCallPopover = lazyNamed(
  () => import('@channel/Call/ActiveCallPopover'),
  'ActiveCallPopover'
);
const CallMiniPlayer = lazyNamed(
  () => import('@channel/Call/CallMiniPlayer'),
  'CallMiniPlayer'
);

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
  const [popupOpen, setPopupOpen] = createSignal(false);
  const [collapsedCallId, setCollapsedCallId] = createSignal<string>();
  const showPlayer = () => {
    const interaction = beginInteraction('call.player.show');
    try {
      setPopupOpen(false);
      setCollapsedCallId(undefined);
    } finally {
      interaction.end();
    }
  };

  // A quick call is backed by a channel call; it lives on its meeting page.
  const meetingShareToken = () => {
    const callId = call?.activeCallId();
    if (!callId) return undefined;
    const meeting = quickCalls
      .calls()
      .find((quickCall) => quickCall.callId === callId);
    return meeting ? getMeetingShareToken(meeting.url) : undefined;
  };

  const open = () => {
    setPopupOpen(false);
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
      <Popover
        open={popupOpen()}
        onOpenChange={setPopupOpen}
        placement="right-end"
        gutter={8}
      >
        <Popover.Trigger
          as={Button}
          variant="success"
          size="icon-md"
          class="size-10 cursor-default rounded-xl"
          aria-label={t('nav.returnToCall')}
          tooltip={{ content: t('nav.returnToCall'), placement: 'right' }}
          draggable={false}
          data-sidebar-next-item="active-call"
        >
          <CallWaveform class="size-5" />
        </Popover.Trigger>
        <Popover.Portal>
          <Suspense>
            <ActiveCallPopover onOpenCall={open} onShowPlayer={showPlayer} />
          </Suspense>
        </Popover.Portal>
      </Popover>
      <Show
        when={
          !isMobile() &&
          !call?.isCallPage() &&
          !!call?.activeChannelId() &&
          collapsedCallId() !== call?.activeCallId()
        }
      >
        <Suspense>
          <CallMiniPlayer
            onOpenCall={open}
            onCollapse={() =>
              setCollapsedCallId(call?.activeCallId() ?? undefined)
            }
          />
        </Suspense>
      </Show>
    </Show>
  );
}

/** Live mark at the bottom of the rail, opening the active call controls. */
export const ReturnToCallButton = () => (
  <Show when={ENABLE_CALLS}>
    <Suspense>
      <ReturnToCallButtonContent />
    </Suspense>
  </Show>
);
