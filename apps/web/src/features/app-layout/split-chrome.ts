import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { globalSplitManager } from '@app/signal/splitLayout';
import { activeAppLayout } from './layout-state';

/**
 * Where "home" is under the active layout: an AI-chat-home layout lands on
 * the chat workspace, everything else on the default inbox route.
 */
export const layoutHomePath = () =>
  activeAppLayout().capabilities.aiChatHome ? '/chat' : DEFAULT_ROUTE;

/**
 * Whether a split still has to introduce itself. When the app chrome names
 * the active view and owns Create, a lone split drops its own title, create
 * button and navigation controls. A second split brings them back: only then
 * does a header have to say which view it is, and only then do per-split
 * controls have somewhere to act.
 */
export const splitOwnsIdentity = () =>
  !activeAppLayout().capabilities.chromeOwnsViewControls ||
  (globalSplitManager()?.splits().length ?? 0) > 1;

/** One search serves every split under this chrome, so the views drop theirs. */
export const splitOwnsSearch = () =>
  !activeAppLayout().capabilities.chromeOwnsViewControls;

/**
 * Whether a view's own chrome may sit on a tinted surface. Flat layouts paint
 * everything at the page's own level, so a sidebar that lifts itself off the
 * panel reads as a leftover from the card look.
 */
export const splitChromeIsTinted = () =>
  !activeAppLayout().capabilities.flatSplitSeams;
