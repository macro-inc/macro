export const callControlPressable =
  'flex items-center justify-center transition-colors cursor-pointer';

export const callControlPanelFlat =
  'border-0 bg-transparent shadow-none';

const callControlPanelHoverOpacity =
  'transition-opacity duration-150 opacity-100 hover:opacity-70';

export const callControlPanelIdle = `text-ink ${callControlPanelHoverOpacity}`;

export const callControlPanelDanger = `text-failure hover:text-failure/90 ${callControlPanelHoverOpacity}`;

export const callControlPanelActive = `text-accent-2 ${callControlPanelHoverOpacity}`;

export const callControlDefaultSize = 'h-10 w-10 rounded-lg';

export const callControlDefaultIdle =
  'border border-edge-muted bg-transparent hover:bg-surface-2/40 text-ink';

export const callControlDefaultActive =
  'border border-accent-2 bg-accent-2/25 hover:bg-accent-2/40 text-accent-2 hover:text-accent-2/70';

export const callControlDefaultDanger =
  'border border-failure/50 hover:bg-failure/40 text-failure hover:text-failure';
