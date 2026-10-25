import { makePersistedState } from '@app/lib/persistence';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { fireAndForget } from '@core/util/fireAndForget';
import { isDesktopPlatform } from '@core/util/platform';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import MagnifyingGlassMinus from '@phosphor/magnifying-glass-minus.svg';
import MagnifyingGlassPlus from '@phosphor/magnifying-glass-plus.svg';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { createSignal } from 'solid-js';
import { z } from 'zod';

/**
 * Page zoom for the desktop app. The webview has none of its own: wry's
 * `zoomHotkeysEnabled` is Windows-only and Tauri's default menu has no zoom
 * items, so cmd/ctrl with +, - and 0 does nothing until the app binds them.
 */

/** Chrome's zoom stops, trimmed to the range the app layout stays usable in. */
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
const DEFAULT_ZOOM = 1;
const STORAGE_KEY = 'macro:desktop:zoom';

const zoomSchema = z
  .number()
  .min(ZOOM_STEPS[0])
  .max(ZOOM_STEPS[ZOOM_STEPS.length - 1]);

function readStoredZoom(): number | undefined {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;
    const parsed = zoomSchema.safeParse(Number(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Storage may be unavailable or blocked; 100% is a fine starting point.
    return;
  }
}

function writeStoredZoom(value: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Storage may be unavailable or full. The zoom still applies this session.
  }
}

const [zoom, setZoom] = makePersistedState(createSignal<number>(DEFAULT_ZOOM), {
  storages: { restore: readStoredZoom, write: writeStoredZoom },
});

function apply(factor: number): void {
  setZoom(factor);
  // Rejects while the webview is being torn down or reloaded, where the next
  // launch re-applies the saved factor anyway.
  fireAndForget(getCurrentWebview().setZoom(factor), 'desktop-zoom');
}

/** Moves to the neighbouring stop, so an off-step saved factor still steps. */
function stepZoom(direction: 1 | -1): void {
  const current = zoom();
  const next =
    direction === 1
      ? ZOOM_STEPS.find((step) => step > current)
      : ZOOM_STEPS.findLast((step) => step < current);
  if (next === undefined) return;
  apply(next);
}

/**
 * Applies the saved zoom and binds the browser zoom hotkeys. Every launch
 * starts the webview at 100%, so the saved factor has to be re-applied.
 */
export function useDesktopZoom(): void {
  if (!isDesktopPlatform()) return;

  if (zoom() !== DEFAULT_ZOOM) apply(zoom());

  registerHotkey({
    hotkeyToken: TOKENS.global.zoomIn,
    // '+' alone covers the numeric keypad, which sends it without shift.
    hotkey: ['cmd+=', 'shift+cmd+=', 'cmd++'],
    scopeId: 'global',
    description: 'Zoom in',
    keyDownHandler: (e) => {
      e?.preventDefault();
      stepZoom(1);
      return true;
    },
    runWithInputFocused: true,
    icon: MagnifyingGlassPlus,
    keywords: ['zoom', 'bigger', 'larger', 'text size'],
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.zoomOut,
    hotkey: 'cmd+-',
    scopeId: 'global',
    description: 'Zoom out',
    keyDownHandler: (e) => {
      e?.preventDefault();
      stepZoom(-1);
      return true;
    },
    runWithInputFocused: true,
    icon: MagnifyingGlassMinus,
    keywords: ['zoom', 'smaller', 'text size'],
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.zoomReset,
    hotkey: 'cmd+0',
    scopeId: 'global',
    description: () => `Actual size (${Math.round(zoom() * 100)}%)`,
    condition: () => zoom() !== DEFAULT_ZOOM,
    keyDownHandler: (e) => {
      e?.preventDefault();
      apply(DEFAULT_ZOOM);
      return true;
    },
    runWithInputFocused: true,
    icon: MagnifyingGlass,
    keywords: ['zoom', 'reset', '100%'],
  });
}
