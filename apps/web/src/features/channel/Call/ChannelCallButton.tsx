import { analytics } from '@app/lib/analytics';
import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { hapticImpact } from '@core/mobile/haptics';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import PhoneIcon from '@icon/wide-call.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { useActiveCallQuery } from '@queries/call/call';
import { Button, cn } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { getCallJoinTab, getCallLeaveTab } from './call-tabs';
import {
  isSlideDownArmed,
  SLIDE_TO_CALL_DISTANCE_PX,
  slideDownProgress,
} from './slide-down-call';
import { useCall } from './use-call';

type SlideGesture = {
  pointerId: number;
  startY: number;
};

export function ChannelCallButton(props: { channelId: string }) {
  const { setActiveTab } = useChannelTab();
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab(getCallJoinTab()),
    onLeave: () => setActiveTab(getCallLeaveTab()),
  });

  const activeCallQuery = useActiveCallQuery(() => props.channelId);
  const isCallInProgress = () => !!activeCallQuery.data;

  const tooltip = () => {
    if (isTouchDevice()) {
      return isCallInProgress() ? 'Slide down to join' : 'Slide down to call';
    }
    return isCallInProgress() ? 'Join Call' : 'Start Call';
  };
  const label = () => (isCallInProgress() ? 'Join' : 'Call');

  const handleJoin = async () => {
    if (call.isJoining()) return;
    const wasExistingCall = isCallInProgress();
    analytics.track('call_action', {
      action: 'join_clicked',
      channelId: props.channelId,
      isExistingCall: wasExistingCall,
    });
    try {
      await call.joinCall();
      // A successful join with no call previously in progress means this user
      // started the call. Fires once, from the starter's client.
      if (!wasExistingCall) {
        analytics.track('call_action', {
          action: 'started',
          channelId: props.channelId,
        });
      }
    } catch (e) {
      console.error('Call action failed', e);
    }
  };

  return (
    <Show when={!call.isInThisChannel()}>
      <Show
        when={isTouchDevice()}
        fallback={
          <Button
            onClick={handleJoin}
            tooltip={tooltip()}
            variant={isCallInProgress() ? 'success' : 'base'}
            size="sm"
            depth={2}
            class={cn(!isCallInProgress() && 'bg-surface')}
          >
            <PhoneIcon />
            <span>{label()}</span>
          </Button>
        }
      >
        <SlideDownCallButton
          label={label()}
          tooltip={tooltip()}
          joining={call.isJoining()}
          callInProgress={isCallInProgress()}
          onCall={handleJoin}
        />
      </Show>
    </Show>
  );
}

function SlideDownCallButton(props: {
  label: string;
  tooltip: string;
  joining: boolean;
  callInProgress: boolean;
  onCall: () => void | Promise<void>;
}) {
  const [offset, setOffset] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  const [trackRevealed, setTrackRevealed] = createSignal(false);

  let gesture: SlideGesture | null = null;

  const trackVisible = () => dragging() || trackRevealed();
  const armed = () => isSlideDownArmed(offset());

  const revealTrack = () => {
    if (trackRevealed()) return;
    setTrackRevealed(true);
    hapticImpact('light');
  };

  const stopListening = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  };

  const endGesture = (complete: boolean) => {
    const active = gesture;
    gesture = null;
    stopListening();
    setDragging(false);
    setOffset(0);
    if (!active) return;
    if (complete) {
      setTrackRevealed(false);
      void props.onCall();
      return;
    }
    revealTrack();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    const progress = slideDownProgress(event.clientY - gesture.startY);
    if (progress.revealTrack) revealTrack();
    if (progress.armed && !armed()) hapticImpact('medium');
    setOffset(progress.offset);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    endGesture(isSlideDownArmed(offset()));
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    endGesture(false);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (props.joining) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    gesture = { pointerId: event.pointerId, startY: event.clientY };
    setDragging(true);
    setOffset(0);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  };

  onCleanup(stopListening);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void props.onCall();
  };

  return (
    <div class="relative isolate">
      <div
        aria-hidden="true"
        class={cn(
          'island pointer-events-none absolute -inset-x-1 top-0 z-0 rounded-full transition-opacity duration-150',
          props.callInProgress && 'bg-success ring-success',
          trackVisible() ? 'opacity-100' : 'opacity-0'
        )}
        style={{
          height: `calc(100% + ${SLIDE_TO_CALL_DISTANCE_PX}px)`,
        }}
      >
        <div class="absolute inset-x-0 bottom-1.5 flex flex-col items-center text-ink-muted">
          <CaretDownIcon class="size-3.5 opacity-40" />
          <CaretDownIcon class="size-3.5 opacity-70" />
          <CaretDownIcon class="size-3.5" />
          <span class="mt-0.5 text-2xs font-medium leading-none tracking-wide">
            Slide
          </span>
        </div>
      </div>
      <Show when={trackVisible()}>
        <span class="sr-only" role="status">
          {`Slide the call button down to ${
            props.callInProgress ? 'join' : 'start'
          } the call`}
        </span>
      </Show>
      <div
        class={cn(
          'relative z-10',
          !dragging() && 'transition-transform duration-200 ease-out'
        )}
        style={{
          transform: `translateY(${offset()}px)`,
        }}
        on:pointerdown={onPointerDown}
      >
        <Button
          tooltip={props.tooltip}
          tooltipDisabled={dragging() || trackRevealed()}
          variant="ghost"
          size="sm"
          depth={2}
          disabled={props.joining}
          class={cn(
            'touch-none select-none active:bg-transparent',
            armed() && 'bg-success/20 text-success'
          )}
          onKeyDown={onKeyDown}
        >
          <PhoneIcon />
          <span>{props.label}</span>
          <CaretDownIcon class="size-3 opacity-70" />
        </Button>
      </div>
    </div>
  );
}
