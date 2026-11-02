import { createSignal } from 'solid-js';

const [nativeUpdateRequired, setNativeUpdateRequired] = createSignal<string>();

/** Why this web bundle needs a newer native app, once something found out. */
export { nativeUpdateRequired };

/**
 * This web bundle needs a native command the installed app lacks, which
 * happens when an over-the-air bundle outruns the app. The app shell asks the
 * user to update; the first reason wins, so the request is shown once.
 */
export function requireNativeUpdate(reason: string): void {
  if (nativeUpdateRequired() === undefined) setNativeUpdateRequired(reason);
}

/** Test seam: forget the request. */
export function resetNativeUpdateRequiredForTests(): void {
  setNativeUpdateRequired(undefined);
}
