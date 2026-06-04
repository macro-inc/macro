import { joinChannelCall, useCallContextOptional } from '@channel/Call';
import PhoneIcon from '@icon/wide-call.svg';
import { useActiveCallQuery } from '@queries/call/call';
import { Button } from '@ui';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';

function formatDuration(startedAt: string | undefined, nowMs: number) {
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  if (!Number.isFinite(startedAtMs)) return '';

  const totalSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function ActiveCallMessage(props: { channelId: string }) {
  const activeCallQuery = useActiveCallQuery(() => props.channelId);
  const callCtx = useCallContextOptional();
  const [nowMs, setNowMs] = createSignal(Date.now());
  const durationTimer = globalThis.setInterval(
    () => setNowMs(Date.now()),
    1000
  );
  onCleanup(() => globalThis.clearInterval(durationTimer));

  const shouldShow = () =>
    !!activeCallQuery.data &&
    (!callCtx?.isInCall() || callCtx.activeChannelId() !== props.channelId);
  const duration = createMemo(() =>
    formatDuration(activeCallQuery.data?.createdAt, nowMs())
  );

  return (
    <Show when={shouldShow()}>
      <div class="w-full flex justify-center">
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
                    <div class="font-medium">
                      A call is active in this channel
                    </div>
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
                    onClick={() => void joinChannelCall(props.channelId)}
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
