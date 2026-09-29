import { defineTourTargets } from '@ui';

/**
 * Parts every view shell registers for tours. They resolve per split, so a
 * step can point at "this view's sidebar" without the view tagging it.
 * `sidebarToggle` is the expand control shown while the sidebar is collapsed,
 * the natural entry for a step whose target lives in the sidebar.
 */
export const VIEW_SHELL_TOUR = defineTourTargets('view-shell', [
  'aside',
  'main',
  'topBar',
  'sidebarToggle',
]);
