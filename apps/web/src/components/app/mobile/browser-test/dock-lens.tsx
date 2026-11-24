// The real dock island and tab-lens controller over plain dock buttons; no
// app state behind them.
import '@fontsource-variable/inter';
import '../../../../index.css';
import BellIcon from '@icon/system/regular/bell.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CheckIcon from '@icon/system/regular/check-square.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import FileIcon from '@icon/system/regular/file.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { DockGoo } from '../DockGoo';
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
  const [nav, setNav] = createSignal<HTMLDivElement>();
  const [search, setSearch] = createSignal<HTMLDivElement>();
  const [merging, setMerging] = createSignal(false);
  return (
    <div class="flex h-dvh flex-col justify-end bg-surface p-4 text-ink">
      <output aria-label="Presses">{presses().join(',')}</output>
      <div class="relative flex w-full justify-between gap-(--mobile-chrome-gutter)">
        <DockGoo nav={nav()} search={search()} merging={merging()} />
        <MobileDockIsland
          ref={setNav}
          class="h-(--mobile-chrome-button-size) min-w-0 flex-1"
        >
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
            {/* Like the dock's More: opens a sheet, selects nothing. */}
            <MobileDockButton
              icon={DotsIcon}
              ariaLabel="More"
              onClick={() => setPresses((all) => [...all, 'More'])}
            />
          </DockTabLens>
        </MobileDockIsland>
        <MobileDockIsland
          ref={setSearch}
          class="shrink-0"
          onPointerDown={() => setMerging(true)}
          onPointerEnd={() => setMerging(false)}
        >
          <MobileDockButton
            icon={SearchIcon}
            ariaLabel="Search"
            onClick={() => setPresses((all) => [...all, 'Search'])}
          />
        </MobileDockIsland>
      </div>
    </div>
  );
}

render(() => <Dock />, document.getElementById('root')!);
