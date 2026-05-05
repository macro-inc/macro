import { cn } from '@ui/utils/classname';
import type { JSX } from 'solid-js';

/**
 * Shared visual shell for modal-style UI. Provides only:
 *
 *   1. A full-viewport backdrop with the diagonal-line pattern.
 *   2. A positioning container that places its children either dead-center
 *      or a fixed distance from the top of the viewport.
 *
 * It deliberately does **not** include a `<Panel>` or any Dialog primitives —
 * compose those yourself as children.
 *
 * For most cases, prefer the all-in-one `<PanelDialog>`. If you need to swap
 * out the overlay element (for example, to use Kobalte's `<Dialog.Overlay>`
 * for accessibility/focus semantics), use `<PanelDialogContainer>` directly
 * alongside your own overlay element styled with `PANEL_DIALOG_OVERLAY_CLASS`.
 *
 * @example All-in-one (defaults to `position="top"`, `topOffset="10vh"`)
 * ```tsx
 * <Dialog open={isOpen()}>
 *   <Dialog.Portal>
 *     <PanelDialog>
 *       <Dialog.Content class="max-w-[calc(100vw-16px)]" style={{ width: '900px' }}>
 *         <Panel active depth={2}>{content}</Panel>
 *       </Dialog.Content>
 *     </PanelDialog>
 *   </Dialog.Portal>
 * </Dialog>
 * ```
 *
 * @example Composed with a custom overlay element
 * ```tsx
 * <Dialog.Overlay class={PANEL_DIALOG_OVERLAY_CLASS} ref={overlayRef} />
 * <PanelDialogContainer topOffset="10rem">
 *   <Dialog.Content>{content}</Dialog.Content>
 * </PanelDialogContainer>
 * ```
 */

/**
 * Tailwind class string for the standard diagonal-pattern modal backdrop.
 * Use this when you need to apply the pattern to a non-`<div>` element
 * (e.g. a Kobalte/Corvu `<Dialog.Overlay>`).
 */
export const PANEL_DIALOG_OVERLAY_CLASS =
  'fixed inset-0 z-modal bg-modal-overlay pattern-edge-muted pattern-diagonal-4';

const DEFAULT_TOP_OFFSET = '10vh';

export type PanelDialogPosition = 'top' | 'center';

export interface PanelDialogOverlayProps {
  class?: string;
}

/**
 * The diagonal-pattern backdrop as a plain `<div>`. For dialog primitives that
 * provide their own overlay element (Kobalte / Corvu), apply
 * `PANEL_DIALOG_OVERLAY_CLASS` to that element instead.
 */
export function PanelDialogOverlay(props: PanelDialogOverlayProps) {
  return (
    <div
      aria-hidden="true"
      class={cn(PANEL_DIALOG_OVERLAY_CLASS, props.class)}
    />
  );
}

interface PanelDialogContainerCommonProps {
  class?: string;
  children: JSX.Element;
}

/**
 * Positioning props are a discriminated union so `topOffset` is only accepted
 * when `position` is `'top'` (its default). Passing `topOffset` alongside
 * `position: 'center'` is a type error.
 */
export type PanelDialogPositionProps =
  | {
      /**
       * Anchored a fixed distance from the top of the viewport.
       * This is the default when `position` is omitted.
       */
      position?: 'top';
      /**
       * Distance from the top of the viewport. Accepts any CSS length
       * (e.g. `'10vh'`, `'10rem'`, `'160px'`). Defaults to `'10vh'`.
       */
      topOffset?: string;
    }
  | {
      /** Vertically + horizontally centered in the viewport. */
      position: 'center';
      /** Not allowed when `position` is `'center'`. */
      topOffset?: never;
    };

export type PanelDialogContainerProps = PanelDialogContainerCommonProps &
  PanelDialogPositionProps;

/**
 * The positioning wrapper. Places children either dead-center in the viewport
 * or a fixed distance from the top.
 */
export function PanelDialogContainer(props: PanelDialogContainerProps) {
  const isTop = () => (props.position ?? 'top') === 'top';

  return (
    <div
      class={cn(
        'fixed inset-0 z-modal flex justify-center px-2',
        isTop() ? 'items-start' : 'items-center',
        props.class
      )}
      style={
        isTop()
          ? {
              'padding-top':
                (props as { topOffset?: string }).topOffset ??
                DEFAULT_TOP_OFFSET,
            }
          : undefined
      }
    >
      {props.children}
    </div>
  );
}

interface PanelDialogCommonProps extends PanelDialogContainerCommonProps {
  /** Extra classes for the backdrop overlay. */
  overlayClass?: string;
  /** Extra classes for the positioning container. */
  containerClass?: string;
}

export type PanelDialogProps = PanelDialogCommonProps &
  PanelDialogPositionProps;

/**
 * Convenience wrapper that renders both the diagonal backdrop and the
 * positioning container. For Dialog primitives that need a typed
 * `<Dialog.Overlay>` element, compose `PanelDialogContainer` with your own
 * overlay element instead.
 */
export function PanelDialog(props: PanelDialogProps) {
  return (
    <>
      <PanelDialogOverlay class={props.overlayClass} />
      <PanelDialogContainer
        {...(props.position === 'center'
          ? { position: 'center' }
          : {
              position: 'top',
              topOffset: (props as { topOffset?: string }).topOffset,
            })}
        class={props.containerClass}
      >
        {props.children}
      </PanelDialogContainer>
    </>
  );
}
