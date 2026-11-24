// The real dock island and tab-lens controller over plain dock buttons; no
// app state behind them.
import '@fontsource-variable/inter';
import '../../../../index.css';
import BellIcon from '@icon/system/regular/bell.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CheckIcon from '@icon/system/regular/check-square.svg';
import FileIcon from '@icon/system/regular/file.svg';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { DockTabLens } from '../DockTabLens';
import { MobileDockButton } from '../MobileDockButton';
import { MobileDockIsland } from '../MobileDockIsland';

const TABS = [
  { label: 'Home', icon: BellIcon },
  { label: 'Chat', icon: ChatIcon },
  { label: 'Tasks', icon: CheckIcon },
  { label: 'Drive', icon: FileIcon },
];

function Dock() {
  const [active, setActive] = createSignal(0);
  const [presses, setPresses] = createSignal<string[]>([]);
  return (
    <div class="flex h-dvh flex-col justify-end bg-surface p-4 text-ink">
      <output aria-label="Presses">{presses().join(',')}</output>
      <MobileDockIsland class="h-(--mobile-chrome-button-size) w-full">
        <DockTabLens activeIndex={active()}>
          <For each={TABS}>
            {(tab, index) => (
              <MobileDockButton
                icon={tab.icon}
                ariaLabel={tab.label}
                active={active() === index()}
                onClick={() => {
                  setActive(index());
                  setPresses((all) => [...all, tab.label]);
                }}
              />
            )}
          </For>
        </DockTabLens>
      </MobileDockIsland>
    </div>
  );
}

render(() => <Dock />, document.getElementById('root')!);
