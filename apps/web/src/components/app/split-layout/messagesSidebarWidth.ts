import { createSignal } from 'solid-js';

export const DEFAULT_MESSAGES_SIDEBAR_WIDTH = 320;
export const MIN_MESSAGES_SIDEBAR_WIDTH = 224;
export const MAX_MESSAGES_SIDEBAR_WIDTH = 360;

export const [messagesSidebarWidth, setMessagesSidebarWidth] = createSignal(
  DEFAULT_MESSAGES_SIDEBAR_WIDTH
);

/** Responsive width currently rendered by the mounted Chat sidebar. */
export const [effectiveMessagesSidebarWidth, setEffectiveMessagesSidebarWidth] =
  createSignal(DEFAULT_MESSAGES_SIDEBAR_WIDTH);

export function clampMessagesSidebarWidth(width: number) {
  return Math.min(
    MAX_MESSAGES_SIDEBAR_WIDTH,
    Math.max(MIN_MESSAGES_SIDEBAR_WIDTH, width)
  );
}
