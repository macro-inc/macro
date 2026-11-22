import { SnapPagerPage, SnapPagerRoot, SnapPagerViewport } from './SnapPager';

export const SnapPager = {
  Root: SnapPagerRoot,
  Viewport: SnapPagerViewport,
  Page: SnapPagerPage,
};

export {
  createSnapPager,
  type SnapPage,
  type SnapPagerController,
  type SnapPagerOptions,
  type SnapPagerPageProps,
  type SnapPagerRootProps,
  type SnapPagerViewportProps,
  useSnapPager,
} from './SnapPager';
