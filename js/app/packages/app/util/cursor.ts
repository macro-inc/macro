const CURSOR_ENABLED_KEY = 'custom-cursor-enabled';

export function getCustomCursorEnabled(): boolean {
  const stored = localStorage.getItem(CURSOR_ENABLED_KEY);
  return stored === null ? true : stored === 'true';
}

export function setCustomCursorEnabled(enabled: boolean) {
  localStorage.setItem(CURSOR_ENABLED_KEY, String(enabled));
  // Dispatch event to notify cursor code of preference change
  window.dispatchEvent(new CustomEvent('cursor-preference-changed'));
}
