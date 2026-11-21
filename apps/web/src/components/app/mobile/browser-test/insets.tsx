import './insets-environment';
import '@fontsource-variable/inter';
import '../../../../index.css';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { useAppSquishHandlers } from '@components/app/useAppSquishHandlers';
import {
  followContentInsetBottom,
  followKeyboardViewport,
  followViewportHeight,
} from '@core/mobile/viewport-insets';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../../features/theme/themes/macro-light';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = 'true';

const params = new URLSearchParams(location.search);
const ROWS = Number(params.get('rows') ?? 120);

/**
 * The app shell's bottom chrome over a long message list: the real float
 * host (a composer accessory over a dock that hides with the keyboard), the
 * real keyboard handlers, and content that reads the published insets the
 * way views do.
 */
function Fixture() {
  useAppSquishHandlers();
  followViewportHeight(document.getElementById('root')!);
  const [lines, setLines] = createSignal(1);
  return (
    <div
      ref={followViewportHeight}
      data-testid="frame"
      class="relative flex w-dvw flex-col h-dvh touch:bg-panel"
    >
      <div
        ref={followContentInsetBottom}
        data-testid="content"
        class="min-h-0 flex-1 overflow-y-auto touch:pb-(--mobile-content-inset-bottom)"
      >
        <For each={Array.from({ length: ROWS }, (_, index) => index)}>
          {(index) => (
            <div class="flex gap-2 px-3 py-2" data-row={index}>
              <div class="size-8 shrink-0 rounded-full bg-ink/10" />
              <div class="min-w-0 flex-1">
                <div class="flex gap-2 text-xs text-ink-muted">
                  <span class="font-medium text-ink">Person {index % 7}</span>
                  <span>10:{String(index % 60).padStart(2, '0')}</span>
                </div>
                <p class="text-sm">
                  Message <strong>{index + 1}</strong> with a{' '}
                  <a href="#row">link</a> and some text that wraps onto a second
                  line on a phone.
                </p>
              </div>
            </div>
          )}
        </For>
        <div
          ref={followContentInsetBottom}
          aria-hidden
          data-testid="spacer"
          class="h-(--mobile-content-inset-bottom)"
        />
      </div>
      <div
        ref={followKeyboardViewport}
        data-testid="sheet"
        class="fixed inset-x-0 bottom-[calc(var(--virtual-keyboard-height,0px)+8px)] h-10 pointer-events-none"
      />
      <FloatRegion region="accessory">
        <div class="px-(--mobile-chrome-gutter)">
          <textarea
            ref={followKeyboardViewport}
            aria-label="Message"
            data-testid="composer"
            rows={lines()}
            onInput={(event) =>
              setLines(event.currentTarget.value.split('\n').length)
            }
            class="pointer-events-auto block w-full resize-none rounded-2xl border border-edge bg-surface px-3 py-2 text-base max-h-[calc(32*var(--dvh,1dvh))]"
          />
        </div>
      </FloatRegion>
      <FloatRegion region="dock" active={() => !virtualKeyboardVisible()}>
        <div class="flex justify-center">
          <button
            type="button"
            data-testid="dock"
            class="pointer-events-auto island h-(--mobile-chrome-button-size) w-64 rounded-full"
          >
            Dock
          </button>
        </div>
      </FloatRegion>
      <FloatRegionHost navigationEdge="bottom" />
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
