import { makePersistedState } from '@app/lib/persistence';
import { createSignal } from 'solid-js';
import { z } from 'zod';

/**
 * Where the app rail (the dock) sits, how big it is, and whether its apps
 * start at its leading edge or sit in its middle. A per-device
 * preference, like Windows' taskbar, set in Settings → Dock.
 *
 * Read synchronously by `index.html`'s boot shell under the same key, so the
 * rail column paints on the right edge before any JS runs; keep the stored
 * shape in step with it.
 */
export const DOCK_STORAGE_KEY = 'macro:dock';

export const DOCK_POSITIONS = ['left', 'top', 'right', 'bottom'] as const;
export const DOCK_SIZES = ['large', 'small'] as const;
export const DOCK_ALIGNMENTS = ['start', 'center'] as const;

export type DockPosition = (typeof DOCK_POSITIONS)[number];
export type DockSize = (typeof DOCK_SIZES)[number];
export type DockAlignment = (typeof DOCK_ALIGNMENTS)[number];

const dockPrefsSchema = z.object({
  position: z.enum(DOCK_POSITIONS),
  size: z.enum(DOCK_SIZES),
  // Added after position and size; earlier saves have none.
  align: z.enum(DOCK_ALIGNMENTS).default('start'),
});

type DockPrefs = z.infer<typeof dockPrefsSchema>;

const DEFAULT_DOCK_PREFS: DockPrefs = {
  position: 'left',
  size: 'large',
  align: 'start',
};

// makePersistedState absorbs storage failures: an unreadable save keeps the
// default, and a blocked write still applies the choice for this session.
function readDockPrefs(): DockPrefs | undefined {
  const raw = localStorage.getItem(DOCK_STORAGE_KEY);
  if (!raw) return;
  const parsed = dockPrefsSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : undefined;
}

function writeDockPrefs(value: DockPrefs) {
  localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(value));
}

// One device-wide appearance preference, like `tooltipsEnabled`: the rail, the
// chrome around it, the split inset, and the settings page all read it.
const [dockPrefs, setDockPrefs] = makePersistedState(
  createSignal<DockPrefs>(DEFAULT_DOCK_PREFS),
  { storages: { restore: readDockPrefs, write: writeDockPrefs } }
);

export const dockPosition = () => dockPrefs().position;
export const dockSize = () => dockPrefs().size;
export const dockAlignment = () => dockPrefs().align;

export const setDockPosition = (position: DockPosition) =>
  setDockPrefs((current) => ({ ...current, position }));

export const setDockSize = (size: DockSize) =>
  setDockPrefs((current) => ({ ...current, size }));

export const setDockAlignment = (align: DockAlignment) =>
  setDockPrefs((current) => ({ ...current, align }));

/** Whether the dock runs along the top or bottom edge. */
export const isDockHorizontal = () =>
  dockPosition() === 'top' || dockPosition() === 'bottom';

type Side = 'top' | 'right' | 'bottom' | 'left';

const OPPOSITE: Record<DockPosition, Side> = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
};

/**
 * The side a rail button's tooltip or menu opens on: away from the screen
 * edge the dock sits against, toward the content. `align` pins a menu's
 * start or end to its button, along the dock.
 */
export function dockPopoverPlacement(): Side;
export function dockPopoverPlacement(
  align: 'start' | 'end'
): `${Side}-${'start' | 'end'}`;
export function dockPopoverPlacement(align?: 'start' | 'end') {
  const side = OPPOSITE[dockPosition()];
  return align ? `${side}-${align}` : side;
}
