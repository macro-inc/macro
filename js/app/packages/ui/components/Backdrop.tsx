import { Dialog } from '@kobalte/core/dialog';
import type { JSX, Ref } from 'solid-js';
import { cn } from '../utils/classname';

const BACKDROP_PATTERN_CLASS =
  'fixed inset-0 z-modal bg-modal-overlay pattern-edge-muted pattern-diagonal-4';

const DEFAULT_TOP_OFFSET = '10vh';
const DEFAULT_WIDTH = '800px';

/** `topOffset` is only valid when `position` is `'top'` (the default). */
type Position =
  | { position?: 'top'; topOffset?: string }
  | { position: 'center'; topOffset?: never };

export type BackdropProps = Position & {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the user dismisses the dialog (Esc, outside click, etc.). */
  onOpenChange?: (open: boolean) => void;
  /** Pixel width of the content panel. Defaults to `'800px'`. */
  width?: string;
  /** Optional ref attached to the content element. */
  contentRef?: Ref<HTMLDivElement>;
  /** Forwarded to Kobalte. Prevent default to keep focus where it was. */
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  /** Forwarded to Kobalte. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** Extra classes for the content element. */
  class?: string;
  children: JSX.Element;
};

/**
 * The standard Macro modal dialog: Kobalte-backed, with the diagonal-pattern
 * scrim and centered/top-anchored panel positioning. This is the only
 * supported way to open a modal in the app.
 *
 * Wrap content in `<Panel>` yourself when you want the standard panel chrome.
 */
export function Backdrop(props: BackdropProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Overlay class={BACKDROP_PATTERN_CLASS} />
        <div
          class={cn(
            'fixed inset-0 z-modal flex justify-center px-2',
            props.position === 'center' ? 'items-center' : 'items-start'
          )}
          style={
            props.position === 'center'
              ? undefined
              : { 'padding-top': props.topOffset ?? DEFAULT_TOP_OFFSET }
          }
        >
          <Dialog.Content
            ref={props.contentRef}
            class={cn(
              'max-w-[calc(100vw-16px)] overflow-hidden portal-scope',
              props.class
            )}
            style={{ width: props.width ?? DEFAULT_WIDTH }}
            onOpenAutoFocus={props.onOpenAutoFocus}
            onCloseAutoFocus={props.onCloseAutoFocus}
            onEscapeKeyDown={props.onEscapeKeyDown}
          >
            {props.children}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}

/**
 * Re-exports of Kobalte dialog sub-parts so consumers don't import
 * `@kobalte/core/dialog` directly.
 */
Backdrop.Title = Dialog.Title;
Backdrop.Description = Dialog.Description;
Backdrop.CloseButton = Dialog.CloseButton;
