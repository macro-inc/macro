import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { CallWaveform } from '@channel/Call/CallWaveform';
import { useActiveCallCompanion } from '@channel/Call/use-active-call-companion';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { lazyNamed } from '@core/util/lazyNamed';
import { Popover } from '@kobalte/core/popover';
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
  const companion = useActiveCallCompanion();

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

  const open = () => {
    setPopupOpen(false);
    analytics.track('sidebar_click', { view: 'active-call' });
    fireAndForget(companion.open(), 'sidebar-return-to-call');
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
          <CallWaveform
            class="size-5"
            callId={call?.activeCallId() ?? undefined}
          />
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
          !companion.inCallView() &&
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
