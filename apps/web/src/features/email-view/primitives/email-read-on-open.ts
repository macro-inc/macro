import { usePreference } from '@app/lib/preferences/use-preference';

/**
 * Whether opening an email thread marks it read, chosen in Settings → Email.
 * When off, threads stay unread until marked read by hand. Like the row style,
 * it is the reader's preference on this device.
 */
const [storedMarkEmailReadOnOpen, setStoredMarkEmailReadOnOpen] =
  usePreference<boolean>('macro:pref:email:mark-read-on-open', {
    default: true,
  });

export const markEmailReadOnOpen = (): boolean =>
  storedMarkEmailReadOnOpen() !== false;

export function setMarkEmailReadOnOpen(enabled: boolean) {
  setStoredMarkEmailReadOnOpen(enabled);
}
