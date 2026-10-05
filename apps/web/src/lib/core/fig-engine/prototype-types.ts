/**
 * A page's prototype as the engine reads it (`inspect/prototype.rs`): flows,
 * the frames that are screens, and every layer with interactions. Enum
 * values are Figma's names.
 */

import type { Rect, Vec2 } from './types';

export interface PrototypeAction {
  /** `INTERNAL_NODE`, `URL`, `BACK`, `CLOSE`, or `NONE`. */
  connection: string;
  /** `NAVIGATE`, `OVERLAY`, `SWAP`, `SCROLL_TO`, or `SWAP_STATE`. */
  navigation: string;
  destination: string | null;
  /** `INSTANT_TRANSITION`, `DISSOLVE`, `SMART_ANIMATE`, `MOVE_FROM_RIGHT`… */
  transition: string;
  /** Seconds. */
  duration: number;
  easing: string | null;
  url: string | null;
  openInNewTab: boolean | null;
  overlayOffset: Vec2 | null;
}

export interface PrototypeInteraction {
  /** `null` for a connection read from a file's legacy fields. */
  id: string | null;
  /** `ON_CLICK`, `ON_HOVER`, `AFTER_TIMEOUT`, `MOUSE_ENTER`… */
  trigger: string;
  /** Seconds, for `AFTER_TIMEOUT`. */
  timeout: number | null;
  actions: PrototypeAction[];
}

export interface PrototypeHotspot {
  id: string;
  name: string;
  /** The screen it is on. */
  frame: string;
  /** Page coordinates. */
  bounds: Rect;
  interactions: PrototypeInteraction[];
}

export interface PrototypeOverlay {
  /** `CENTER`, `TOP_LEFT`, …, `BOTTOM_RIGHT`, or `MANUAL`. */
  position: string;
  closeOnClickOutside: boolean;
  /** `RRGGBBAA`. */
  background: string | null;
}

export interface PrototypeFrame {
  id: string;
  name: string;
  bounds: Rect;
  overlay: PrototypeOverlay | null;
}

export interface PrototypeFlow {
  frame: string;
  name: string;
  description: string;
}

export interface PrototypeInfo {
  /** The page's start frame in files from before flows. */
  start: string | null;
  flows: PrototypeFlow[];
  /** Screens in page order. */
  frames: PrototypeFrame[];
  /** In paint order: a later hotspot draws above an earlier one. */
  hotspots: PrototypeHotspot[];
}
