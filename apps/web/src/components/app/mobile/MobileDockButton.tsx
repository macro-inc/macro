import { hapticImpact } from '@core/mobile/haptics';
import { ICON_ANIMATION_DURATION_MS } from '@icon/animation';
import { cn } from '@ui';
import { createSignal } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { MobileTouchIconComponent } from './MobileTouchMenu';
import { pressPulse } from './pressPulse';

// Keeps the directive import from being tree-shaken / lint-flagged.
false && pressPulse;

type MobileDockButtonProps = {
  icon: MobileTouchIconComponent;
  /** Accessible name for the icon-only button. */
  ariaLabel: string;
  onClick: () => void;
  active?: boolean;
  class?: string;
  /** Plain svg icons (e.g. Bell) don't accept `triggerAnimation`. */
  animateIcon?: boolean;
};

/**
 * Renders flat: hosts wrap it in a MobileDockIsland (alone or grouped with
 * other controls) to give it the floating chrome.
 */
export function MobileDockButton(props: MobileDockButtonProps) {
  const [animating, setAnimating] = createSignal(false);

  let activatedOnPointerDown = false;

  const activate = () => {
    hapticImpact('light');
    if (props.animateIcon !== false) {
      setAnimating(true);
      setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
    }
    props.onClick();
  };

  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      use:pressPulse
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        activatedOnPointerDown = event.pointerType !== 'mouse';
        if (activatedOnPointerDown) {
          // Navigate immediately, without letting the press move focus away
          // from a newly opened search input.
          event.preventDefault();
          activate();
        }
      }}
      onMouseDown={(event) => {
        // Physical iOS devices can still emit compatibility mouse events
        // after a cancelled pointerdown.
        if (activatedOnPointerDown) event.preventDefault();
      }}
      onClick={(event) => {
        // Touch already activated; keep mouse, keyboard, and assistive clicks.
        if (!activatedOnPointerDown || event.detail === 0) activate();
        activatedOnPointerDown = false;
      }}
      class={cn(
        'relative flex size-(--mobile-chrome-button-size) shrink-0 items-center justify-center rounded-full',
        props.active && 'text-accent',
        props.class
      )}
    >
      <div class="size-(--mobile-chrome-icon-size) shrink-0 [&_svg]:size-(--mobile-chrome-icon-size)">
        {props.animateIcon === false ? (
          <Dynamic component={props.icon} />
        ) : (
          <Dynamic component={props.icon} triggerAnimation={animating()} />
        )}
      </div>
    </button>
  );
}
