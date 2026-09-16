import { ComposerSurface, cn } from '@ui';
import type { JSX } from 'solid-js';

interface MessageCardProps {
  messageId: string | null | undefined;
  isSelected: boolean;
  allowHover: boolean;
  isTouch: boolean;
  /**
   * Click or Enter on the row. Clicks landing on a control inside the card are
   * excluded so row activation never fights an inner button.
   */
  onActivate?: () => void;
  onSelect?: () => void;
  onHover?: () => void;
  onUnhover?: () => void;
  onFocus?: (element: HTMLElement) => void;
  children: JSX.Element;
}

/**
 * The card every thread message sits in, collapsed or expanded. It owns the
 * chrome and the row-level interactions — selection, hover, focus scrolling —
 * so both content shapes read identically and a single DOM node carries
 * `data-message-body-id` across an expand.
 *
 * Desktop shares the chat composer's rounded surface, soft shadow and dark
 * rim. Hover adds only a faint tint; keyboard focus uses a neutral outline.
 * Touch devices retain their existing card and selection treatment.
 */
export function MessageCard(props: MessageCardProps) {
  return (
    <div class="shrink-0 flex justify-center w-full">
      <div class="@container/message macro-message-width macro-message-padding mobile:px-0 w-full">
        <ComposerSurface
          as="div"
          class={cn(
            'relative p-4 outline-none',
            props.isTouch && 'rounded-lg bg-message border border-edge-muted',
            'mobile:rounded-none mobile:border-0 mobile:border-t mobile:bg-transparent mobile:px-4 mobile:ring-0 mobile:shadow-none mobile:focus-visible:bg-hover',
            props.isTouch
              ? props.isSelected
                ? 'z-1 light-mode:shadow-lg light-mode:shadow-drop-shadow dark-mode:ring-1 dark-mode:ring-accent/40'
                : props.allowHover && 'hover:overlay-hover'
              : [
                  'focus-visible:outline-1 focus-visible:outline-ink/20 focus-visible:outline-offset-2',
                  props.isSelected && 'z-1',
                  !props.isSelected &&
                    props.allowHover &&
                    'hover:overlay-[color-mix(in_srgb,var(--color-ink)_1%,transparent)]',
                ]
          )}
          style={{ '--user-icon-width': '1rem' }}
          data-message-body-id={props.messageId}
          tabIndex={0}
          onPointerEnter={props.onHover}
          onPointerLeave={props.onUnhover}
          onClick={(e) => {
            // Selection is unconditional: a click that lands on a link or a
            // button inside the card focuses that child, not the card.
            props.onSelect?.();
            const target = e.target;
            if (target instanceof Element && target.closest('[data-button]')) {
              return;
            }
            props.onActivate?.();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !props.onActivate) return;
            e.preventDefault();
            e.stopPropagation();
            props.onActivate();
          }}
          onFocus={(e) => {
            props.onFocus?.(e.currentTarget);
            props.onSelect?.();
          }}
        >
          {props.children}
        </ComposerSurface>
      </div>
    </div>
  );
}
