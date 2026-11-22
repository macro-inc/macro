import { cn } from '@ui/utils/classname';
import { createEffect, type JSX, on, Show } from 'solid-js';
import type { Point, Rect } from '../core/geometry';
import type { ScreenFrameSize, ScreenRect } from '../transports/types';
import { Loupe } from './loupe';

export type ScreenStageHandlers = {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onWheel: (event: WheelEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onKeyUp: (event: KeyboardEvent) => void;
  onCompositionEnd: (event: CompositionEvent) => void;
  onBlur: () => void;
  onPaste: (event: ClipboardEvent) => void;
};

/**
 * The picture: a container the size of the viewer, the frame element the
 * transport renders into at the guest's native size (placed by `transform`),
 * and an input surface over both that takes every pointer, wheel and key.
 * `children` are overlays (state, notices, zoom) above the input surface.
 */
export function ScreenStage(props: {
  label: string;
  /** The hidden text field's name: where keys go while driving. */
  keyboardLabel: string;
  frame: ScreenFrameSize | undefined;
  transform: string | undefined;
  /** Where the picture shows: its edge, and the driving frame, follow it. */
  pictureBox: Rect | undefined;
  /** Amber frame while someone drives. */
  driven: boolean;
  /** This viewer drives: the input surface takes keyboard focus. */
  drivingMe: boolean;
  /**
   * The keyboard stays the viewer's: while driving, and while a dropped
   * drive reconnects. Keys typed while not driving are swallowed, not sent.
   */
  ownsKeyboard: boolean;
  /**
   * Counts the person's own Take over clicks here: the drive that follows
   * one gets the keyboard (`focusOnTakeOver`), since the button that had
   * focus is gone by then.
   */
  takeOvers: number;
  /** Not on touch screens, where focus would raise the on-screen keyboard. */
  focusOnTakeOver: boolean;
  /** Grey the last picture out while it isn't live. */
  stale: boolean;
  loupe:
    | { at: Point; guest: Point; magnification: number; containerWidth: number }
    | undefined;
  snapshot: (rect: ScreenRect) => Promise<ImageBitmap | undefined> | undefined;
  handlers: ScreenStageHandlers;
  containerRef: (element: HTMLDivElement) => void;
  frameRef: (element: HTMLDivElement) => void;
  class?: string;
  children?: JSX.Element;
}) {
  let frameElement: HTMLDivElement | undefined;
  let keyboardField: HTMLTextAreaElement | undefined;

  // Typing when the drive paused (a dropped connection): once driving again,
  // the keys go to the guest as before, even if something took focus.
  let typingWhenPaused = false;
  // A Take over clicked here and not yet answered with the drive.
  let tookOverHere = false;

  createEffect(
    on(
      () => props.takeOvers,
      () => {
        tookOverHere = true;
      },
      { defer: true }
    )
  );

  // Handed back, or the lease went to someone else: give the keyboard back to
  // the app, rather than keep typing invisibly into the hidden field.
  createEffect(
    on(
      () => props.ownsKeyboard,
      (owns) => {
        if (owns || !keyboardField) return;
        typingWhenPaused = false;
        keyboardField.value = '';
        if (document.activeElement === keyboardField) keyboardField.blur();
      },
      { defer: true }
    )
  );

  createEffect(
    on(
      () => props.drivingMe,
      (driving, wasDriving) => {
        // `on` runs on every change of what the accessor reads, not only of
        // its value: act on real flips only.
        if (!keyboardField || driving === wasDriving) return;
        if (!driving) {
          typingWhenPaused = document.activeElement === keyboardField;
          tookOverHere = false;
          return;
        }
        const resumed = typingWhenPaused;
        const tookOver = tookOverHere && props.focusOnTakeOver;
        typingWhenPaused = false;
        tookOverHere = false;
        // Only when focus went nowhere: never take it from another control.
        const focusLost =
          document.activeElement === null ||
          document.activeElement === document.body;
        if ((resumed || tookOver) && focusLost)
          keyboardField.focus({ preventScroll: true });
      },
      { defer: true }
    )
  );

  return (
    <div
      ref={props.containerRef}
      // A well darker than the panel, so a white guest page shows its edges.
      class={cn('relative overflow-hidden bg-page', props.class)}
    >
      <div
        ref={(element) => {
          frameElement = element;
          props.frameRef(element);
        }}
        class={cn(
          'absolute top-0 left-0 origin-top-left transition-[filter] duration-300 motion-reduce:transition-none',
          props.stale && 'brightness-50 grayscale'
        )}
        style={{
          width: props.frame ? `${props.frame.width}px` : '0px',
          height: props.frame ? `${props.frame.height}px` : '0px',
          transform: props.transform,
          visibility: props.frame && props.transform ? 'visible' : 'hidden',
        }}
      />

      {/*
        Keys go to a hidden text field rather than the surface itself, so an
        input method (Japanese, Chinese, Korean, dead keys) can compose in it;
        focusable only while driving.
      */}
      <textarea
        ref={keyboardField}
        aria-label={props.keyboardLabel}
        tabIndex={props.ownsKeyboard ? 0 : -1}
        // While driving every key belongs to the remote computer: the app's
        // hotkeys stand down (core/hotkey) and nothing bubbles past here.
        data-owns-keyboard={props.ownsKeyboard ? '' : undefined}
        autocomplete="off"
        inputmode="none"
        autocapitalize="off"
        spellcheck={false}
        class="pointer-events-none absolute top-0 left-0 size-px resize-none overflow-hidden border-0 p-0 opacity-0"
        onKeyDown={(event) => {
          if (!props.ownsKeyboard) return props.handlers.onKeyDown(event);
          event.stopPropagation();
          if (!props.drivingMe) {
            // Reconnecting a drive: the key reaches nobody, but the release
            // chord still leaves the keyboard (the handler sends nothing).
            event.preventDefault();
            props.handlers.onKeyDown(event);
            // Left on purpose: the resume doesn't take focus back.
            if (document.activeElement !== keyboardField)
              typingWhenPaused = false;
            return;
          }
          props.handlers.onKeyDown(event);
        }}
        onKeyUp={(event) => {
          if (props.ownsKeyboard) event.stopPropagation();
          props.handlers.onKeyUp(event);
        }}
        onCompositionEnd={(event) => props.handlers.onCompositionEnd(event)}
        onBlur={() => props.handlers.onBlur()}
        onPaste={(event) => props.handlers.onPaste(event)}
      />
      <div
        role="img"
        aria-label={props.label}
        class="absolute inset-0 touch-none outline-hidden select-none"
        onPointerDown={(event) => {
          // `inputmode="none"` keeps a phone's own keyboard down: touch
          // types through the key bar, a hardware keyboard through here.
          if (props.drivingMe) keyboardField?.focus({ preventScroll: true });
          props.handlers.onPointerDown(event);
        }}
        onPointerMove={(event) => props.handlers.onPointerMove(event)}
        onPointerUp={(event) => props.handlers.onPointerUp(event)}
        onPointerCancel={(event) => props.handlers.onPointerCancel(event)}
        onWheel={(event) => props.handlers.onWheel(event)}
        onContextMenu={(event) => props.handlers.onContextMenu(event)}
      />

      {/*
        Drawn over the picture, not the stage, so the picture's own pixels
        never paint over its edge or the driving frame.
      */}
      <Show when={props.frame && props.pictureBox}>
        {(box) => (
          <div
            aria-hidden="true"
            data-screen-picture-edge={props.driven ? 'driven' : ''}
            class={cn(
              'pointer-events-none absolute ring-1 ring-edge ring-inset',
              props.driven && 'outline-2 -outline-offset-2 outline-amber'
            )}
            style={{
              left: `${box().left}px`,
              top: `${box().top}px`,
              width: `${box().width}px`,
              height: `${box().height}px`,
            }}
          />
        )}
      </Show>

      <Show when={props.loupe}>
        {(loupe) => (
          <Loupe
            at={loupe().at}
            guest={loupe().guest}
            magnification={loupe().magnification}
            containerWidth={loupe().containerWidth}
            media={() =>
              frameElement?.querySelector('canvas, video') ?? undefined
            }
            snapshot={props.snapshot}
          />
        )}
      </Show>

      {props.children}
    </div>
  );
}
