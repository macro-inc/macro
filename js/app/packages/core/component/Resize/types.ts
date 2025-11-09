export type PanelId = string;

export const HORIZONTAL = 'horizontal' as const;
export const VERTICAL = 'vertical' as const;

// TODO (seamus): next version should use these to as default sizes instead of
// current behavior which is hard-coded "1fr"
export type PanelSizeSpec =
  | { kind: 'px'; px: number }
  | { kind: 'percent'; percent: number }
  | { kind: 'fr'; fr: number }
  | { kind: 'auto' };

export type Panel = {
  id: PanelId;
  minSize: number;
  maxSize: number;
  share: number;
  target: PanelSizeSpec;
};

export type PanelConfig = {
  id: PanelId;
  minSize?: number;
  maxSize?: number;
  target?: PanelSizeSpec;
};

export type LayoutResult = {
  sizes: Map<PanelId, number>;
  offsets: Map<PanelId, number>;
  shares: Map<PanelId, number>;
};

export type ResizeZoneCtx = {
  direction: 'horizontal' | 'vertical';
  register: (panel: PanelConfig) => void;
  unregister: (id: PanelId) => void;
  gutterSize: () => number;
  size: () => number;
  sizeOf: (id: PanelId) => () => number;
  offsetOf: (id: PanelId) => () => number;
  canFit: (panel: Partial<PanelConfig>) => boolean;
  hide: (id: PanelId) => void;
  show: (id: PanelId) => void;
  isHidden: (id: PanelId) => boolean;
};
