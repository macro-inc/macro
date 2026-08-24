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
  isHorizontalSlide,
  isSlideDownArmed,
  SLIDE_HINT_TIMEOUT_MS,
  SLIDE_KNOB_SIZE_PX,
  SLIDE_RETURN_MS,
  SLIDE_SLOT_PADDING_PX,
  SLIDE_TO_CALL_DISTANCE_PX,
  slideDownFraction,
  slideDownProgress,
} from './slide-down-call';
import { useCall } from './use-call';

type SlideGesture = {
  pointerId: number;
  startX: number;
  /** Pointer Y that corresponds to an offset of zero. */
  originY: number;
};

export function ChannelCallButton(props: { channelId: string }) {
  const { setActiveTab } = useChannelTab();
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab(getCallJoinTab()),
    onLeave: () => setActiveTab(getCallLeaveTab()),
  });

  const activeCallQuery = useActiveCallQuery(() => props.channelId);
  const isCallInProgress = () => !!activeCallQuery.data;

  const actionLabel = () => (isCallInProgress() ? 'Join Call' : 'Start Call');
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
            tooltip={actionLabel()}
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
          actionLabel={actionLabel()}
          joining={call.isJoining()}
          callInProgress={isCallInProgress()}
          onCall={handleJoin}
        />
      </Show>
    </Show>
  );
}

function SlideDownCallButton(props: {
  actionLabel: string;
  joining: boolean;
  callInProgress: boolean;
  onCall: () => void | Promise<void>;
}) {
  const [offset, setOffset] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  const [trackRevealed, setTrackRevealed] = createSignal(false);
  const [placing, setPlacing] = createSignal(false);

  let knobWrapper: HTMLDivElement | undefined;
  let gesture: SlideGesture | null = null;
  let placingTimer: number | undefined;
  let hintTimer: number | undefined;

  const trackVisible = () => dragging() || trackRevealed();
  const armed = () => isSlideDownArmed(offset());
  const traveled = () => slideDownFraction(offset());
  const verb = () => (props.callInProgress ? 'join' : 'call');

  // Anything the finger drives runs at 0ms while dragging and eases home on
  // release. Every animated part shares this so they settle together.
  const settleDuration = () => (dragging() ? '0ms' : `${SLIDE_RETURN_MS}ms`);

  /**
   * Where the knob is actually painted, which lags `offset` while the release
   * animation is still running. Seeding a new gesture from this stops the knob
   * jumping out from under a finger that re-grabs it mid-flight.
   */
  const paintedOffset = (): number => {
    const transform = knobWrapper && getComputedStyle(knobWrapper).transform;
    if (!transform?.startsWith('matrix')) return offset();
    return new DOMMatrixReadOnly(transform).m42;
  };

  const revealTrack = () => {
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(
      () => setTrackRevealed(false),
      SLIDE_HINT_TIMEOUT_MS
    );
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
      window.clearTimeout(hintTimer);
      setTrackRevealed(false);
      // Hold the confirmed look until the knob has travelled home, so placing
      // the call does not flicker back to the resting style mid-flight.
      window.clearTimeout(placingTimer);
      setPlacing(true);
      placingTimer = window.setTimeout(
        () => setPlacing(false),
        SLIDE_RETURN_MS
      );
      void props.onCall();
      return;
    }
    revealTrack();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    const dy = event.clientY - gesture.originY;
    if (isHorizontalSlide(event.clientX - gesture.startX, dy)) {
      endGesture(false);
      return;
    }
    const progress = slideDownProgress(dy);
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
    // A second finger landing mid-slide must not retarget the gesture.
    if (gesture) return;
    if (props.joining) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    window.clearTimeout(placingTimer);
    setPlacing(false);

    const painted = paintedOffset();
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      originY: event.clientY - painted,
    };
    setDragging(true);
    setOffset(painted);
    // Capture so a release outside the window still ends the gesture.
    knobWrapper?.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  };

  onCleanup(() => {
    stopListening();
    window.clearTimeout(placingTimer);
    window.clearTimeout(hintTimer);
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    // Keyboards cannot slide, so the key press is the confirmation. Guard the
    // repeat stream so holding the key cannot queue up joins.
    if (event.repeat || props.joining) return;
    void props.onCall();
  };

  return (
    <div class="relative isolate">
      {/* The slot the knob slides down. It stays inside the knob's own column
          and grows downward out of the header island, so revealing it never
          eats into the island's silhouette. */}
      <div
        aria-hidden="true"
        class={cn(
          'absolute inset-x-0 top-0 z-0 overflow-hidden rounded-full',
          'bg-inset ring ring-edge-muted ring-inset',
          // Palette-independent depth cue: `inset` and `chrome` sit within a
          // step of each other in the shipped ramps, so colour alone does not
          // read as a recess.
          'shadow-[inset_0_2px_6px_oklch(0_0_0/0.45)]',
          'transition-[height,opacity] ease-out',
          trackVisible()
            ? 'pointer-events-auto touch-none opacity-100'
            : 'pointer-events-none opacity-0'
        )}
        style={{
          height: trackVisible()
            ? `calc(100% + ${SLIDE_SLOT_PADDING_PX + SLIDE_TO_CALL_DISTANCE_PX}px)`
            : '100%',
          'transition-duration': `${SLIDE_RETURN_MS}ms`,
        }}
        on:pointerdown={onPointerDown}
      >
        {/* Travelled distance. Runs past the knob's top edge to its centre so
            the knob always covers the seam and the two read as one shape. */}
        <div
          class={cn(
            'absolute inset-x-0 top-0 transition-[height,background-color] ease-out',
            armed() ? 'bg-success/40' : 'bg-success/20'
          )}
          style={{
            height: `${offset() + SLIDE_KNOB_SIZE_PX / 2}px`,
            'transition-duration': settleDuration(),
          }}
        />
        {/* Landing target, faded out as the knob arrives on top of it. */}
        <div
          class="absolute inset-x-0 bottom-2 flex justify-center text-ink transition-opacity ease-out"
          style={{
            opacity: `${1 - traveled()}`,
            'transition-duration': settleDuration(),
          }}
        >
          <CaretDownIcon class="size-4" />
        </div>
      </div>

      {/* Names the gesture at its destination. Spans the slot and aligns to the
          bottom so it sits clear of the header island's own row. */}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute top-0 right-full mr-2 flex items-end"
        style={{
          height: `calc(100% + ${SLIDE_SLOT_PADDING_PX + SLIDE_TO_CALL_DISTANCE_PX}px)`,
        }}
      >
        <div
          class={cn(
            'grid h-7 place-items-center rounded-full px-3',
            'bg-dialog text-xs leading-none font-medium text-ink',
            'ring ring-edge-muted shadow-lg shadow-drop-shadow',
            'transition-opacity ease-out',
            trackVisible() ? 'opacity-100' : 'opacity-0'
          )}
          style={{ 'transition-duration': `${SLIDE_RETURN_MS}ms` }}
        >
          {/* Both strings share one grid cell so the chip keeps a single width
              and cannot jitter as the threshold is crossed. */}
          <span
            class={cn(
              'col-start-1 row-start-1 whitespace-nowrap',
              armed() && 'invisible'
            )}
          >
            Slide down to {verb()}
          </span>
          <span
            class={cn(
              'col-start-1 row-start-1 whitespace-nowrap',
              !armed() && 'invisible'
            )}
          >
            Release to {verb()}
          </span>
        </div>
      </div>

      {/* Kept mounted so the live region is in the accessibility tree before
          its text changes; a region inserted with its text is not announced. */}
      <span class="sr-only" role="status">
        {!trackVisible()
          ? ''
          : armed()
            ? `Release to ${verb()}`
            : `Slide the call button down to ${verb()}`}
      </span>

      {/* The transition stays declared at all times and only its duration
          changes, so releasing animates instead of snapping (adding the
          transition in the same tick as the transform would not animate). */}
      <div
        ref={knobWrapper}
        class="relative z-10 transition-transform ease-out"
        style={{
          transform: `translateY(${offset()}px)`,
          'transition-duration': settleDuration(),
        }}
        on:pointerdown={onPointerDown}
      >
        <Button
          // No tooltip: this control is touch-only, and a hover tooltip from a
          // hybrid pointer would sit on top of the slot mid-drag.
          aria-label={props.actionLabel}
          variant="ghost"
          size="icon-md"
          depth={2}
          disabled={props.joining}
          class={cn(
            'touch-none select-none rounded-full',
            'transition-[background-color,color] ease-out',
            // Solid only while sliding: at rest this stays an ordinary
            // header-island icon button.
            (armed() || placing()) && 'bg-success text-surface',
            !armed() && !placing() && trackVisible() && 'bg-ink text-surface'
          )}
          style={{ 'transition-duration': `${SLIDE_RETURN_MS}ms` }}
          onKeyDown={onKeyDown}
        >
          <PhoneIcon />
        </Button>
      </div>
    </div>
  );
}
