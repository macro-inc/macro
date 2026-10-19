import { isIgnorableError } from '@core/util/ignorableErrors';

/** PostHog's `$exception_list`: the thrown error first, then its causes. */
type ExceptionList = {
  value?: string;
  stacktrace?: { frames?: { filename?: string }[] };
}[];

/** Frames run outermost first, so the last one is where the error was thrown. */
export function isIgnorableException(
  exceptionList: ExceptionList | undefined
): boolean {
  const thrown = exceptionList?.[0];
  if (!thrown) return false;
  return isIgnorableError({
    message: thrown.value,
    source: thrown.stacktrace?.frames?.at(-1)?.filename,
  });
}

const NATIVE_ASSET_ORIGIN =
  /^(?:tauri:\/\/localhost|https?:\/\/tauri\.localhost)(?=\/app\/)/;

/**
 * Native apps run the same hashed bundle files the web app serves under
 * `<web origin>/app/`, but load them from the webview's private origin, which
 * PostHog cannot fetch. Point frames at the public copy so PostHog can
 * download the file and its source map.
 */
export function rewriteNativeFrameUrls(
  exceptionList: ExceptionList | undefined,
  webOrigin: string
): void {
  for (const exception of exceptionList ?? []) {
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.filename) {
        frame.filename = frame.filename.replace(NATIVE_ASSET_ORIGIN, webOrigin);
      }
    }
  }
}
