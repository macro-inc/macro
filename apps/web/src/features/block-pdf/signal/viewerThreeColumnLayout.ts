import { createBlockSignal } from '@core/block';
import type { ThreeColumnLayout } from '@core/util/threeColumnLayout';

export const THREAD_WIDTH = 293;
export const MIN_THREAD_GAP = 16;
export const THREAD_VERTICAL_GAP = 24;
export const SHOW_MORE_BUTTON_HEIGHT = 32;

export const GUTTER_PX = 6;
export const GUTTER_MARGIN = GUTTER_PX * 3;
export const MIN_LEFT_COLUMN_WIDTH = 170;
export const MIN_RIGHT_COLUMN_WIDTH = 115;
export const MAX_EDITOR_LEFT_HAND_WIDTH = 350;
export const MAX_EDITOR_LEFT_HAND_WIDTH_W_GUTTER =
  MAX_EDITOR_LEFT_HAND_WIDTH - GUTTER_MARGIN;
export const DEFAULT_LEFT_WIDTH = 370 - GUTTER_MARGIN;

export const MIN_COMFY_LEFT_WIDTH_PX = 265;

export const MIN_COMFY_SEARCH_WIDTH_PX = 300;
export const MIN_COMFY_PINS_WIDTH_PX = 200;

// const RESIZE_DEBOUNCE_MS = 16;
//
// const viewerColumnConfig: ThreeColumnConfig = {
//   gutterPx: GUTTER_PX,
//   minLeftColumnWidth: MIN_LEFT_COLUMN_WIDTH,
//   minRightColumnWidth: MIN_RIGHT_COLUMN_WIDTH,
//   maxLeftHandWidth: MAX_EDITOR_LEFT_HAND_WIDTH,
//   rightHandWidth: 293,
// };

export const viewerThreeColumnLayout = createBlockSignal<ThreeColumnLayout>({
  isInitialized: false,
  leftWidth: DEFAULT_LEFT_WIDTH,
  rightWidth: THREAD_WIDTH,
  rightMargin: GUTTER_PX,
  centerWidth: -1,
  windowWidth: -1,
  marginWidth: -1,
});

// export const useViewerThreeColumnLayoutResizer = () => {
//   const debouncedSetLayout = createMemo(() =>
//     debounce(
//       (layout: ThreeColumnLayout) => setLayout(layout),
//       RESIZE_DEBOUNCE_MS
//     )
//   );
//   const [viewerThreeColumns, setLayout] = viewerThreeColumnLayout;
//   const windowSize = windowSizeSignal.get;
//   const priorWindowWidth = createBlockSignal<number>(0);
//   const [docWidth, setDocWidth] = createSignal<number>(0);
//   const currentMaxPageWidth = useCurrentMaxPageWidth();
//
//   createEffect(() => {
//     if (!viewerReadySignal()) {
//       return;
//     }
//     const widest = currentMaxPageWidth();
//     console.log('setting doc width', widest);
//
//     setDocWidth(widest);
//   });
//
//   const windowWidth = windowSize().width;
//   createEffect(() => {
//     if (!viewerReadySignal()) {
//       return;
//     }
//
//     const layout = resizeColumns(
//       docWidth(),
//       windowWidth,
//       viewerThreeColumns(),
//       viewerColumnConfig
//     );
//
//     priorWindowWidth[1](windowWidth);
//     debouncedSetLayout()(layout);
//   });
// };
