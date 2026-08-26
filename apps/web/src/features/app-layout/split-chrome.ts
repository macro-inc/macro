import { globalSplitManager } from '@app/signal/splitLayout';
import { activeAppLayout } from './layout-state';

/**
 * Whether a split still has to introduce itself. Under the top bar the bar
 * already names the active view and owns Create, so a lone split drops its own
 * title, create button and navigation controls. A second split brings them
 * back: only then does a header have to say which view it is, and only then do
 * per-split controls have somewhere to act.
 */
export const splitOwnsIdentity = () =>
  !activeAppLayout().capabilities.usesTopBar ||
  (globalSplitManager()?.splits().length ?? 0) > 1;

/** One search serves every split under the top bar, so the views drop theirs. */
export const splitOwnsSearch = () => !activeAppLayout().capabilities.usesTopBar;

/**
 * Whether a view's own chrome may sit on a tinted surface. Flat layouts paint
 * everything at the page's own level, so a sidebar that lifts itself off the
 * panel reads as a leftover from the card look.
 */
export const splitChromeIsTinted = () =>
  !activeAppLayout().capabilities.flatSplitSeams;
