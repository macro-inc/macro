import { Dialog } from '@kobalte/core';
import { cn } from '@ui/utils/classname';
import type { JSXElement, Ref } from 'solid-js';
import { Panel } from '@ui';
import {
  PanelDialogContainer,
  PANEL_DIALOG_OVERLAY_CLASS,
} from './PanelDialog';

export interface DialogWrapperProps {
  children: JSXElement;
  class?: string;
  width?: string;
  overlayRef?: Ref<HTMLDivElement>;
  contentRef?: Ref<HTMLDivElement>;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Your one-stop-shop for creating Macro-themed Dialogs. Handles both the Overlay and the frame around the Dialog Content.
 *
 * Correct usage is to put this immediately below the <Dialog.Portal>. No other Dialog machinery necesary. Just this and then the content.
 *
 * Note: DialogWrapper constrains its height by applying a max-height to its immediate children. This allows the child content to be properly constrained (e.g. for flex-box layouts) without the children needing to know that they are inside a dialog. For this to work as expected, child content should start with a single container element.
 *
 * Internally this delegates the diagonal backdrop + positioning to
 * `PanelDialog`'s primitives so all Macro-themed dialogs share one source of truth.
 */
export function DialogWrapper(props: DialogWrapperProps) {
  const width = props.width ?? '800px';

  return (
    <>
      <Dialog.Overlay
        class={PANEL_DIALOG_OVERLAY_CLASS}
        ref={props.overlayRef}
      />
      <PanelDialogContainer topOffset="10rem">
        <Dialog.Content
          class={cn(
            'max-w-[calc(100vw-16px)] overflow-hidden portal-scope'
          )}
          style={{ width: width }}
          onOpenAutoFocus={props.onOpenAutoFocus}
          onCloseAutoFocus={props.onCloseAutoFocus}
        >
          <Panel depth={2} active>
            <div
              class={cn('*:max-h-[75vh]', props.class)}
              ref={props.contentRef}
            >
              {props.children}
            </div>
          </Panel>
        </Dialog.Content>
      </PanelDialogContainer>
    </>
  );
}
