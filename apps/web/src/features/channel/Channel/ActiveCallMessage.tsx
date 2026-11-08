import { analytics } from '@app/lib/analytics';
import { t } from '@app/lib/i18n';
import { getCallJoinTab } from '@channel/Call/call-tabs';
import { formatCallElapsed } from '@channel/Call/discussion/format-call-elapsed';
import { useCall } from '@channel/Call/use-call';
import { fireAndForget } from '@core/util/fireAndForget';
import PhoneIcon from '@icon/system/regular/phone-call.svg';
import { useActiveCallQuery } from '@queries/call/call';
import { Button } from '@ui';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { useChannelTab } from './ChannelTabContext';

export function ActiveCallMessage(props: {
  channelId: string;
  /** The call's own row is on screen and says all this already. */
  hidden?: boolean;
  /** Messages in the call's thread, when its discussion is in the channel. */
  messageCount?: (callId: string) => number | undefined;
  /** Takes the viewer to the call's row. */
  onOpenRow?: (callId: string) => void;
}) {
  const activeCallQuery = useActiveCallQuery(() => props.channelId);
  const { setActiveTab } = useChannelTab();
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab(getCallJoinTab()),
  });
  const [nowMs, setNowMs] = createSignal(Date.now());
  const durationTimer = globalThis.setInterval(
    () => setNowMs(Date.now()),
    1000
  );
  onCleanup(() => globalThis.clearInterval(durationTimer));

  const shouldShow = () =>
    !props.hidden && !!activeCallQuery.data && !call.isInThisChannel();
  const messageCount = () => {
    const callId = activeCallQuery.data?.callId;
    return callId ? props.messageCount?.(callId) : undefined;
  };
  const duration = createMemo(() =>
    formatCallElapsed(activeCallQuery.data?.createdAt, nowMs())
  );

  async function handleJoin() {
    analytics.track('call_action', {
      action: 'join_clicked',
      channelId: props.channelId,
      isExistingCall: true,
    });
    try {
      await call.joinCall();
    } catch (error) {
      console.error('Failed to join call', error);
    }
  }

  return (
    <Show when={shouldShow()}>
      {/* Full-frame mobile/tablet: place above the floating input/dock stack. */}
      <div class="w-full flex justify-center touch:pb-(--mobile-content-inset-bottom)">
        <div class="macro-message-width w-full relative">
          <div class="w-full pr-2 pl-(--message-padding-x)">
            <div
              class="grid min-w-0 items-start gap-x-2 py-2"
              style={{
                'grid-template-columns':
                  'var(--user-icon-width) minmax(0, 1fr)',
                'grid-template-areas': '"icon content"',
              }}
            >
              <div
                class="shrink-0 size-(--user-icon-width) rounded-full bg-success/15 text-success flex items-center justify-center"
                style={{ 'grid-area': 'icon' }}
              >
                <PhoneIcon class="size-5" />
              </div>
              <div
                class="min-w-0 rounded-md border border-edge-muted bg-surface px-3 py-2 text-sm text-ink"
                style={{ 'grid-area': 'content' }}
              >
                <div class="flex min-w-0 items-center gap-2">
                  <div class="min-w-0 flex-1">
                    <Show
                      when={messageCount()}
                      fallback={
                        <div class="font-medium">
                          A call is active in this channel
                        </div>
                      }
                    >
                      {(count) => (
                        <button
                          type="button"
                          class="font-medium hover:underline"
                          onClick={() => {
                            const callId = activeCallQuery.data?.callId;
                            if (callId) props.onOpenRow?.(callId);
                          }}
                        >
                          {t('calls.activeCallMessages', { count: count() })}
                        </button>
                      )}
                    </Show>
                    <Show when={duration()}>
                      {(value) => (
                        <div class="text-xs text-ink-extra-muted">
                          Active for{' '}
                          <span class="font-mono tabular-nums">{value()}</span>
                        </div>
                      )}
                    </Show>
                  </div>
                  <Button
                    variant="success"
                    size="sm"
                    class="shrink-0"
                    onClick={() => fireAndForget(handleJoin(), 'channel-call')}
                  >
                    <PhoneIcon class="size-3.5" />
                    Join
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
