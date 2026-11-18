import { UnsavedChangesDialog } from '@ui';

export function BookingPageLeaveDialog(props: {
  open: boolean;
  pending: boolean;
  canSave: boolean;
  error: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <UnsavedChangesDialog
      {...props}
      title="Save booking page changes?"
      description="Your booking page has unsaved changes. Save them before leaving, or discard them."
      cancelLabel="Keep editing"
    />
  );
}
