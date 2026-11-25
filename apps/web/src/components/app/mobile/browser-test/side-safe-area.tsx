// A full-frame channel pane beside a side safe area (the iPhone Duo's folded
// clock and camera column), framed like the app: the frame pads the safe area,
// the pane floats a header and bottom chrome over its message list. No network.
import '@fontsource-variable/inter';
import '../../../../index.css';
import { ScrollToBottomOverlay } from '@app/features/channel/Channel/ScrollToBottomOverlay';
import {
  ThreadList,
  type ThreadListScrollState,
} from '@app/features/channel/Channel/ThreadList';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../../features/theme/themes/macro-light';
import { FloatRegionScope } from '../float-regions/FloatRegionScope';
import { MobileTopEdgeFade } from '../MobileEdgeFade';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = 'true';
document.documentElement.dataset.touchDevice = 'true';
const params = new URLSearchParams(location.search);
for (const side of ['left', 'right']) {
  document.documentElement.style.setProperty(
    `--safe-${side}`,
    `${Number(params.get(`safe${side === 'left' ? 'Left' : 'Right'}`) ?? 0)}px`
  );
}
/** A list parked, hidden, under the pane, as a narrow collection stacks them. */
const stacked = params.has('stacked');

/** Floating header and bottom chrome heights the list scrolls beneath. */
const HEADER = 56;
const BOTTOM_CHROME = 90;

const keys = Array.from({ length: 120 }, (_, index) => `message-${index}`);

const [parked, setParked] = createSignal(true);
declare global {
  interface Window {
    /** Parks the stacked pane under the channel, or brings it back. */
    setParked?: (parked: boolean) => void;
  }
}
window.setParked = setParked;

function Fixture() {
  const [parkedPane, setParkedPane] = createSignal<HTMLElement>();
  const [state, setState] = createSignal<ThreadListScrollState>();
  let scroller: HTMLElement | undefined;
  return (
    <div class="relative flex h-dvh w-dvw bg-panel pr-(--safe-right) pl-(--safe-left)">
      {stacked && (
        <div
          ref={setParkedPane}
          data-parked-pane
          class="absolute inset-y-0 right-(--safe-right) left-(--safe-left) overflow-hidden"
          classList={{ invisible: parked() }}
          style={{ '--mobile-content-inset-top': `${HEADER}px` }}
        >
          <FloatRegionScope anchor={parkedPane} active={() => !parked()}>
            <MobileTopEdgeFade />
          </FloatRegionScope>
        </div>
      )}
      <div
        data-pane
        // A split pane is a size container, which also holds its `fixed`
        // descendants, and clips.
        class="@container relative size-full overflow-hidden"
        style={{ '--mobile-content-inset-top': `${HEADER}px` }}
      >
        <ThreadList
          keys={() => keys}
          initialPosition={{ type: 'latest' }}
          insets={{ start: HEADER, end: BOTTOM_CHROME }}
          onScroll={(next) => {
            setState(next);
            scroller ??=
              document.querySelector<HTMLElement>('[data-channel-scroll]') ??
              undefined;
          }}
        >
          {(item) => (
            <div data-message={item.id} class="px-4 py-2">
              {item.id}
            </div>
          )}
        </ThreadList>
        <MobileTopEdgeFade />
        <ScrollToBottomOverlay
          scrollState={state}
          onScrollToBottom={() => scroller?.scrollTo({ top: 1e9 })}
        />
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
