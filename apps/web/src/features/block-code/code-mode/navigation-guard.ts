import type { LeavingMessage, PreviewFrame } from './frame-helper';

export type NavigationGuardOptions = {
  token: string;
  /** The page started to navigate away; close the frame. */
  onLeave: () => void;
};

function isLeavingMessage(
  data: unknown,
  token: string
): data is LeavingMessage {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return message.type === 'macro:leaving' && message.token === token;
}

/**
 * Call `onLeave` once when a program frame starts to leave its page: its
 * helper reports the unload, and a second `load` in the same window (a
 * navigation the helper missed) confirms it. A page that runs programs as the
 * viewer could otherwise carry what it read out in the URL it navigates to,
 * the one path its policy leaves open.
 *
 * A frame moved in the document (its element detached and reattached, as a
 * layout change can do) loads its page again, from the same `srcdoc`, in a
 * new window. Only the host can do that, so a `load` in a new window is a
 * fresh start, never a navigation, which keeps the frame's window; the hosts
 * reset for the new window themselves. Returns the detach function.
 */
export function attachNavigationGuard(
  frame: PreviewFrame,
  options: NavigationGuardOptions
): () => void {
  // The window the frame's page loaded in; undefined before the first load.
  let loadedIn: Window | null | undefined;
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    options.onLeave();
  };

  const onMessage = (event: MessageEvent) => {
    if (left) return;
    if (!frame.contentWindow || event.source !== frame.contentWindow) return;
    if (isLeavingMessage(event.data, options.token)) leave();
  };
  const onLoad = () => {
    if (left) return;
    const current = frame.contentWindow;
    if (current === loadedIn) {
      leave();
      return;
    }
    loadedIn = current;
  };

  window.addEventListener('message', onMessage);
  frame.addEventListener('load', onLoad);
  return () => {
    window.removeEventListener('message', onMessage);
    frame.removeEventListener('load', onLoad);
  };
}
