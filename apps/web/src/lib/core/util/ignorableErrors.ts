const IGNORABLE_MESSAGES = [
  // Browsers report this benign layout warning as an uncaught error.
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
];

const EXTENSION_SCRIPT = /^(?:chrome|moz|safari(?:-web)?)-extension:\/\//;

/**
 * Browser noise that is not a Macro bug, dropped before it reaches PostHog or
 * Datadog. `source` is the URL of the script that threw.
 */
export function isIgnorableError(error: {
  message?: string;
  source?: string;
  /** The native app has its own Java bridge; keep those failures. */
  nativeApp?: boolean;
}): boolean {
  const { message, source, nativeApp } = error;
  // Instagram and Facebook's Android browser throws this from its injected
  // navigation logger. The same text can come from the native app's bridge.
  const inAppBrowserBridge =
    !nativeApp &&
    message !== undefined &&
    message.includes('Java object is gone');
  return (
    inAppBrowserBridge ||
    (source !== undefined && EXTENSION_SCRIPT.test(source)) ||
    (message !== undefined &&
      IGNORABLE_MESSAGES.some((ignored) => message.includes(ignored)))
  );
}
