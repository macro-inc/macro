import type { LeavingMessage } from './frame-helper';

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
 * helper reports the unload, and a second `load` (a navigation the helper
 * missed) confirms it. A page that runs programs as the viewer could
 * otherwise carry what it read out in the URL it navigates to, the one path
 * its policy leaves open. Returns the detach function.
 */
export function attachNavigationGuard(
  frame: HTMLIFrameElement,
  options: NavigationGuardOptions
): () => void {
  let loads = 0;
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    options.onLeave();
  };

  const onMessage = (event: MessageEvent) => {
    if (!frame.contentWindow || event.source !== frame.contentWindow) return;
    if (isLeavingMessage(event.data, options.token)) leave();
  };
  const onLoad = () => {
    loads += 1;
    if (loads > 1) leave();
  };

  window.addEventListener('message', onMessage);
  frame.addEventListener('load', onLoad);
  return () => {
    window.removeEventListener('message', onMessage);
    frame.removeEventListener('load', onLoad);
  };
}
