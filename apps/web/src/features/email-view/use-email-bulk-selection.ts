import { toast } from '@core/component/Toast/Toast';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { useMutationUndoContext } from '@queries/undo';
import { confirmDialog } from '@ui';
import type { EmailBulkOverlay } from './primitives/bulk-overlay';
import { createEmailBulkSelection } from './primitives/bulk-selection';
import type { EmailBulkQuery } from './queries/bulk-query';
import { emailBulkThreads } from './queries/bulk-threads';

export type UseEmailBulkSelectionOptions = {
  overlay: EmailBulkOverlay;
  query: () => EmailBulkQuery | undefined;
  viewLabel: () => string;
};

/** The Email view's bulk selection, wired to the email service and app shell. */
export function useEmailBulkSelection(options: UseEmailBulkSelectionOptions) {
  const { pushUndo } = useMutationUndoContext();

  return createEmailBulkSelection({
    ...options,
    capabilities: {
      ...emailBulkThreads,
      confirm: (prompt) => confirmDialog(prompt),
      failure: (message) => toast.failure(message),
      announce: ({ message, partial, undo, redo }) => {
        let toastId: number | undefined;
        const show = () => {
          toastId = (partial ? toast.alert : toast.success)(message, {
            actions: [
              {
                label: 'Undo',
                icon: ArrowCounterClockwise,
                onClick: () => {
                  void handle.undo({
                    onError: (error) => toast.failure(error.message),
                  });
                },
              },
            ],
            duration: 6_000,
            stack: true,
            hideOnMobile: true,
          });
        };
        const handle = pushUndo({
          label: 'Bulk email action',
          undo,
          redo,
          onUndone: () => {
            if (toastId !== undefined) toast.dismiss(toastId);
          },
          onRedone: show,
        });
        show();
      },
    },
  });
}
