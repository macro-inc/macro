import XIcon from '@icon/system/regular/x.svg';
import { Button, cn } from '@ui';
import type { JSX } from 'solid-js';

/**
 * A movable thing on the board. The frame owns position, entrance motion,
 * fading, the open action and the close button; the variant draws the rest.
 *
 * The open target is a `role="button"` sibling of the close button rather
 * than its ancestor, so the two stay separate controls.
 */
export function BoardNode(props: {
  x: number;
  y: number;
  /** Draws the node centered on (x, y) rather than hanging from it. */
  centered?: boolean;
  /** A fixed width from the layout; otherwise the content sizes the node. */
  width?: number;
  label: string;
  dismissLabel: string;
  dragging: boolean;
  faded: boolean;
  onPointerDown: (event: PointerEvent) => void;
  onOpen: () => void;
  onDismiss: () => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  ref?: (element: HTMLDivElement) => void;
  /** Placement of the close button against the node's own shape. */
  dismissClass?: string;
  /** Shape of the open target, so its focus ring follows the node. */
  shapeClass?: string;
  /**
   * `group` when the node holds its own buttons (a person's lines), so the
   * frame is a focusable group rather than a button around buttons.
   */
  container?: 'button' | 'group';
  children: JSX.Element;
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    // Keys pressed on a button inside a group belong to that button.
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      props.onOpen();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      props.onDismiss();
      return;
    }
    props.onKeyDown?.(event);
  };

  return (
    <div
      ref={props.ref}
      data-board-node=""
      class={cn(
        'group/node absolute top-0 left-0 cursor-default',
        !props.dragging &&
          'transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
        props.dragging && 'z-20',
        props.faded && !props.dragging && 'opacity-55 hover:opacity-100'
      )}
      style={{
        transform: `translate(${props.x}px, ${props.y}px)${props.centered ? ' translate(-50%, -50%)' : ''}`,
        width: props.width === undefined ? undefined : `${props.width}px`,
      }}
      onPointerDown={(event) => props.onPointerDown(event)}
    >
      <div
        role={props.container === 'group' ? 'group' : 'button'}
        tabIndex={0}
        aria-label={props.label}
        class={cn(
          'block outline-none transition-[scale,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          props.dragging && 'scale-[1.03] shadow-xl',
          props.shapeClass
        )}
        onClick={() => {
          if (props.container !== 'group') props.onOpen();
        }}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
      {/* Positioned out of flow so it never adds to the node's measured size. */}
      <div
        data-board-node-action=""
        class={cn(
          'absolute transition-opacity',
          'opacity-0 group-hover/node:opacity-100 group-focus-within/node:opacity-100 touch:opacity-100',
          props.dragging && 'invisible',
          props.dismissClass ?? '-top-2.5 -right-2.5'
        )}
      >
        <Button
          variant="secondary"
          size="icon-xs"
          aria-label={props.dismissLabel}
          tooltip={props.dismissLabel}
          onClick={(event) => {
            event.stopPropagation();
            props.onDismiss();
          }}
        >
          <XIcon class="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
