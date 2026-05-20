export type PanelId = string;

const _HORIZONTAL = 'horizontal' as const;
const _VERTICAL = 'vertical' as const;

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
  register: (panel: PanelConfig, index?: number) => void;
  unregister: (id: PanelId) => void;
  update: (id: PanelId, config: { minSize?: number; maxSize?: number }) => void;
  gutterSize: () => number;
  size: () => number;
  sizeOf: (id: PanelId) => () => number;
  offsetOf: (id: PanelId) => () => number;
  canFit: (panel: Partial<PanelConfig>) => boolean;
  hide: (id: PanelId) => void;
  show: (id: PanelId) => void;
  isHidden: (id: PanelId) => boolean;
};
