import { createUnsavedChangesGuard } from '@core/util/create-unsaved-changes-guard';

export function createBookingPageLeave(options: {
  dirty: () => boolean;
  busy: () => boolean;
  save: () => Promise<void>;
  discard: () => void;
}) {
  return createUnsavedChangesGuard({
    ...options,
    saveError: 'Could not save your booking page.',
  });
}
