import { cn } from '@ui';
import type { JSX } from 'solid-js';

interface MessageCardProps {
  messageId: string | null | undefined;
  isSelected: boolean;
  allowHover: boolean;
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
 * Selection (one message at a time) reads as depth rather than an accent ring:
 * a drop shadow in light mode, an accent-tinted border in dark mode where a
 * shadow would be invisible. The border is present in every state so moving the
 * selection never reflows the list. Hover is the `hover` tint painted *over*
 * the card background (see the `overlay-*` utility) rather than replacing it,
 * so the card keeps its lift; the selected card skips the tint so selection
 * always reads as one settled state.
 *
 * There is no focus ring: focusing the card selects it, so the selected styling
 * is already the focus indicator. A ring would also linger after a collapse,
 * since this node keeps DOM focus while its content swaps.
 */
export function MessageCard(props: MessageCardProps) {
  return (
    <div class="shrink-0 flex justify-center w-full">
      <div class="@container/message macro-message-width macro-message-padding w-full">
        <div
          class={cn(
            'relative p-4 rounded-lg bg-message border border-edge-muted outline-none',
            props.isSelected
              ? 'z-1 light-mode:shadow-lg light-mode:shadow-drop-shadow dark-mode:ring-1 dark-mode:ring-accent/40'
              : props.allowHover && 'hover:overlay-hover'
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
        </div>
      </div>
    </div>
  );
}
