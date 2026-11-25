import '@app/index.css';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ViewShell } from '../ViewShell';
import { ViewSidebar } from '../ViewSidebar';

declare global {
  interface Window {
    setSplitWidth: (width: number) => void;
  }
}

// A list view (Notifications) opened beside another split, at a split width
// the test resizes across the layout breakpoint.
function Fixture() {
  const search = new URLSearchParams(window.location.search);
  const [width, setWidth] = createSignal(Number(search.get('width') ?? 1000));
  window.setSplitWidth = setWidth;
  const [open, setOpen] = createSignal(false);
  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('list-split');
  const panel = {
    handle: { isFirst: () => false, isPopover: () => false },
    isPanelActive: () => true,
    splitHotkeyScope: hotkeyScope,
  } as unknown as SplitPanelContextType;

  return (
    <SplitPanelContext.Provider value={panel}>
      <div
        ref={attachHotkeys}
        data-testid="split"
        class="h-[600px] bg-panel text-ink"
        style={{ width: `${width()}px` }}
      >
        <ViewShell.Root
          asidePreferenceKey="list-split"
          aside={{ width: 360, max: 480, preserveDuringResize: false }}
          asideList={{ open: open(), onBack: () => setOpen(false) }}
          main={{ preferredWidth: 640 }}
          resizable
        >
          <ViewShell.Aside>
            <ViewSidebar.Header>
              <ViewSidebar.Title>Notifications</ViewSidebar.Title>
            </ViewSidebar.Header>
            <button type="button" onClick={() => setOpen(true)}>
              Open row
            </button>
          </ViewShell.Aside>
          <ViewShell.Main>
            <ViewShell.TopBar>
              <h1>Preview</h1>
            </ViewShell.TopBar>
            <Show when={open()} fallback={<p>Nothing selected</p>}>
              <p>Row preview</p>
            </Show>
          </ViewShell.Main>
        </ViewShell.Root>
      </div>
    </SplitPanelContext.Provider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
