import { Dialog, type DialogProps } from '@ui/components/Dialog';
import { cn } from '@ui/utils/classname';

/** Sheet dialogs are opened by menus and shortcuts, outside a Dialog.Trigger. */
export function SpreadsheetDialog(
  props: Omit<DialogProps, 'onOpenAutoFocus' | 'onCloseAutoFocus'> & {
    onRestoreFocus?: () => void;
  }
) {
  let opener: HTMLElement | undefined;
  return (
    <Dialog
      {...props}
      class={cn(
        'max-h-[calc(100dvh-2rem)] overflow-y-auto touch:[&_button]:min-h-[44px] touch:[&_button]:min-w-[44px] touch:[&_button]:text-[max(14px,0.875rem)] touch:[&_p]:text-[max(14px,0.875rem)] touch:[&_label]:text-[max(14px,0.875rem)]',
        props.class
      )}
      onOpenAutoFocus={() => {
        // Keep Kobalte's default initial autofocus on the first tabbable field.
        opener =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : undefined;
      }}
      onCloseAutoFocus={(event) => {
        if (props.onRestoreFocus) {
          event.preventDefault();
          queueMicrotask(props.onRestoreFocus);
          return;
        }
        if (!opener?.isConnected) return;
        event.preventDefault();
        opener.focus({ preventScroll: true });
      }}
    />
  );
}

SpreadsheetDialog.Title = Dialog.Title;
SpreadsheetDialog.Description = Dialog.Description;
SpreadsheetDialog.CloseButton = Dialog.CloseButton;
