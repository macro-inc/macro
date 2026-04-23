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
  'border border-edge-muted bg-transparent hover:bg-edge/20 text-ink';

export const callControlDefaultActive =
  'border border-accent-2 bg-accent-2/25 text-accent-2 transition-opacity hover:bg-accent-2 hover:text-accent-2 hover:opacity-70';

export const callControlDefaultDanger =
  'border border-failure/50 bg-transparent text-failure transition-colors hover:bg-failure hover:text-ink';
