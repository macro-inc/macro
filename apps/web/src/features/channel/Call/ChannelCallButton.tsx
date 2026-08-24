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
  SLIDE_SLOT_PADDING_PX,
  SLIDE_TO_CALL_DISTANCE_PX,
  slideDownFraction,
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
  const traveled = () => slideDownFraction(offset());

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
      {/* The slot the knob slides down. Overhangs the knob on every side so it
          reads as a recess rather than extra chrome, and origin-top scale
          anchors the reveal under the button. */}
      <div
        aria-hidden="true"
        class={cn(
          'pointer-events-none absolute -inset-x-1 z-0 origin-top overflow-hidden rounded-full',
          'bg-inset ring ring-edge ring-inset',
          'transition-[opacity,scale] duration-200 ease-out',
          trackVisible() ? 'scale-y-100 opacity-100' : 'scale-y-90 opacity-0'
        )}
        style={{
          top: `-${SLIDE_SLOT_PADDING_PX}px`,
          height: `calc(100% + ${SLIDE_SLOT_PADDING_PX * 2 + SLIDE_TO_CALL_DISTANCE_PX}px)`,
        }}
      >
        {/* Travelled distance, filled in behind the knob so the fill and the
            knob stay one connected shape instead of two objects with a gap. */}
        <div
          class={cn(
            'absolute inset-x-0 top-0 transition-colors duration-200',
            armed() ? 'bg-success/40' : 'bg-success/20'
          )}
          style={{ height: `${offset()}px` }}
        />
        {/* Landing target, faded out as the knob arrives on top of it. */}
        <div
          class="absolute inset-x-0 bottom-2 flex justify-center text-ink"
          style={{ opacity: `${1 - traveled()}` }}
        >
          <CaretDownIcon class="size-4" />
        </div>
      </div>
      <Show when={trackVisible()}>
        <span class="sr-only" role="status">
          {`Slide the call button down to ${
            props.callInProgress ? 'join' : 'start'
          } the call`}
        </span>
      </Show>
      {/* The transition stays declared at all times and only its duration
          changes, so releasing animates instead of snapping (adding the
          transition in the same tick as the transform would not animate). */}
      <div
        class="relative z-10 transition-transform ease-out"
        style={{
          transform: `translateY(${offset()}px)`,
          'transition-duration': dragging() ? '0ms' : '260ms',
        }}
        on:pointerdown={onPointerDown}
      >
        {/* The knob is icon-only, so name the gesture while it is in progress.
            Rides along with the knob so the two never drift apart. */}
        <div
          aria-hidden="true"
          class={cn(
            'pointer-events-none absolute top-1/2 right-full mr-2 -translate-y-1/2',
            'flex h-7 items-center rounded-full px-3 whitespace-nowrap',
            'bg-chrome text-xs leading-none font-medium text-ink ring ring-edge',
            'transition-opacity duration-200 ease-out',
            trackVisible() ? 'opacity-100' : 'opacity-0'
          )}
        >
          {armed()
            ? `Release to ${props.callInProgress ? 'join' : 'call'}`
            : `Slide down to ${props.callInProgress ? 'join' : 'call'}`}
        </div>
        <Button
          // No tooltip: this control is touch-only, and a hover tooltip from a
          // hybrid pointer would sit on top of the slot mid-drag.
          aria-label={props.tooltip}
          variant="ghost"
          size="icon-md"
          depth={2}
          disabled={props.joining}
          class={cn(
            'touch-none select-none rounded-full',
            'transition-[background-color,color,scale] duration-200',
            // Solid only while sliding: at rest this stays an ordinary
            // header-island icon button.
            armed() && 'bg-success text-surface',
            !armed() && trackVisible() && 'bg-ink text-surface',
            dragging() && 'scale-105'
          )}
          onKeyDown={onKeyDown}
        >
          <PhoneIcon />
        </Button>
      </div>
    </div>
  );
}
