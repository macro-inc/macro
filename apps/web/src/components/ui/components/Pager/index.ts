import { PagerPage, PagerRoot, PagerViewport } from './Pager';
/** Compound components for rendering and interacting with a controlled pager. */
export const Pager = {
  Root: PagerRoot,
  Viewport: PagerViewport,
  Page: PagerPage,
};

export {
  createPager,
  type PagerChange,
  type PagerController,
  type PagerDirection,
  type PagerNavigationSource,
  type PagerOptions,
  type PagerPageProps,
  type PagerRootProps,
  type PagerViewportProps,
  usePager,
} from './Pager';
export {
  PagerSwipeGestures,
  type PagerSwipeGesturesProps,
} from './PagerSwipeGestures';
