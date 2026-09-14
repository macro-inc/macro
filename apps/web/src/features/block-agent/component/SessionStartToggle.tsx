import ArrowUp from '@phosphor/arrow-up.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { cn, Tooltip } from '@ui';
import { Show } from 'solid-js';
import {
  SESSION_START_TOGGLE_DRAG_THRESHOLD,
  type SessionStartMode,
  sessionStartModeFromPointer,
} from './session-start-mode';

export function SessionStartToggle(props: {
  mode: SessionStartMode;
  pending?: boolean;
  disabled?: boolean;
  error?: boolean;
  onModeChange: (mode: SessionStartMode) => void;
  onStart: () => void;
}) {
  let switchEl: HTMLDivElement | undefined;
  let pointerStartX = 0;
  let dragging = false;
  let tracking = false;

  const background = () => props.mode === 'background';
  const startLabel = () => {
    if (props.pending) return 'Starting…';
    if (props.error) return 'Retry';
    return background() ? 'Start session in background' : 'Start session';
  };

  const modeFromPoint = (
    clientX: number,
    target: EventTarget | null
  ): SessionStartMode => {
    const el = (switchEl ?? target) as HTMLElement | undefined;
    const rect = el?.getBoundingClientRect();
    if (!rect) return props.mode;
    return sessionStartModeFromPointer(clientX, rect);
  };

  const onDown = (event: MouseEvent) => {
    if (props.disabled || event.button > 0) return;
    pointerStartX = event.clientX;
    dragging = false;
    tracking = true;
    if ('pointerId' in event) {
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(
          (event as PointerEvent).pointerId
        );
      } catch {
        // jsdom does not implement pointer capture.
      }
    }
  };

  const onMove = (event: MouseEvent) => {
    if (!tracking) return;
    if (
      !dragging &&
      Math.abs(event.clientX - pointerStartX) >=
        SESSION_START_TOGGLE_DRAG_THRESHOLD
    ) {
      dragging = true;
    }
    if (!dragging) return;
    const next = modeFromPoint(event.clientX, event.currentTarget);
    if (next !== props.mode) props.onModeChange(next);
  };

  const onUp = () => {
    tracking = false;
  };

  const ignoreClickAfterDrag = (event: MouseEvent) => {
    if (!dragging) return false;
    event.preventDefault();
    dragging = false;
    return true;
  };

  const selectMode = (mode: SessionStartMode) => (event: MouseEvent) => {
    if (ignoreClickAfterDrag(event) || props.disabled) return;
    if (mode !== props.mode) props.onModeChange(mode);
  };

  const onTrackClick = (event: MouseEvent) => {
    if (ignoreClickAfterDrag(event) || props.disabled) return;
    const next = modeFromPoint(event.clientX, event.currentTarget);
    if (next !== props.mode) props.onModeChange(next);
  };

  const start = (event: MouseEvent) => {
    event.stopPropagation();
    if (ignoreClickAfterDrag(event) || props.disabled) return;
    props.onStart();
  };

  const labelClass = (active: boolean) =>
    cn(
      'shrink-0 text-[11px] font-medium leading-none transition-colors duration-150',
      active ? 'text-ink' : 'text-ink-muted hover:text-ink'
    );

  return (
    <div
      role="group"
      aria-label="Session start mode"
      data-session-start-mode={props.mode}
      class={cn(
        'flex h-7 shrink-0 select-none items-center gap-1.5',
        props.disabled && 'opacity-60'
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={props.disabled}
        aria-pressed={props.mode === 'live'}
        class={labelClass(props.mode === 'live')}
        onClick={selectMode('live')}
      >
        Live
      </button>

      <div
        ref={switchEl}
        data-session-start-switch
        class={cn(
          'relative isolate h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors duration-200 ease-out touch-none',
          background() ? 'bg-accent' : 'bg-ink-muted/40'
        )}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onClick={onTrackClick}
      >
        <button
          type="button"
          disabled={props.disabled}
          aria-label={startLabel()}
          class={cn(
            'absolute top-0.5 left-0.5 z-20 flex size-6 items-center justify-center rounded-full bg-surface text-ink shadow-sm transition-transform duration-200 ease-out',
            '[&_svg]:size-3.5 [&_svg]:stroke-[4px]',
            background() && 'translate-x-5',
            !props.disabled && 'active:scale-95'
          )}
          onClick={start}
        >
          <Show
            when={!props.pending}
            fallback={<SpinnerIcon class="animate-spin" />}
          >
            <ArrowUp />
          </Show>
        </button>
      </div>

      <Tooltip
        label="Background"
        shortcut="cmd"
        placement="top"
        disabled={props.disabled}
      >
        <button
          type="button"
          tabIndex={-1}
          disabled={props.disabled}
          aria-pressed={props.mode === 'background'}
          class={labelClass(props.mode === 'background')}
          onClick={selectMode('background')}
        >
          Background
        </button>
      </Tooltip>
    </div>
  );
}
