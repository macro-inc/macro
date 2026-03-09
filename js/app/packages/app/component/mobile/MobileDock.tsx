import TrayIcon from '@phosphor-icons/core/bold/tray-bold.svg?component-solid';
import SearchIcon from '@phosphor-icons/core/regular/magnifying-glass.svg?component-solid';
import DotsThreeIcon from '@phosphor-icons/core/regular/dots-three.svg?component-solid';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedFolderIcon } from '@macro-icons/wide/animating/folder';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { type Component, createSignal, For, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Popover } from '@kobalte/core/popover';
import { cn } from '@ui/utils/classname';
import { useSplitLayout } from '../split-layout/layout';
import { SIDEBAR_LINKS } from '../app-sidebar/sidebar';
import { type ListView } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { SearchState } from './mobileSearchState';

type MobileDockButtonProps = {
  icon: Component<
    JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
  >;
  label: string;
  onClick: () => void;
  active?: boolean;
};

function MobileDockButton(props: MobileDockButtonProps) {
  return (
    <button
      type="button"
      onPointerDown={() => {
        impactFeedback('light');
        props.onClick();
      }}
      class={cn(
        'flex flex-col items-center justify-center w-[20%] pt-3',
        props.active && 'text-accent'
      )}
    >
      <div class="w-6 h-6 [&_svg]:size-6">
        <Dynamic component={props.icon} />
      </div>
      <span class="text-xs">{props.label}</span>
    </button>
  );
}

const PRIMARY_IDS = ['inbox', 'channels', 'files'] as const;

const MORE_VIEWS = SIDEBAR_LINKS.filter(
  (l) => !(PRIMARY_IDS as readonly string[]).includes(l.id)
);

function MorePopover(props: {
  active: boolean;
  onNavigate: (id: ListView) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [anchorRef, setAnchorRef] = createSignal<HTMLElement>();

  return (
    <>
      <button
        onPointerDown={() => {
          impactFeedback('light');
          setOpen((prev) => !prev);
        }}
        class={cn(
          'flex flex-col items-center justify-center w-[20%] pt-3',
          props.active && 'text-accent'
        )}
        ref={setAnchorRef}
      >
        <DotsThreeIcon class="w-6 h-6" />
        <span class="text-xs">More</span>
      </button>
      <Popover
        open={open()}
        onOpenChange={setOpen}
        placement="top"
        anchorRef={anchorRef}
      >
        <Popover.Portal>
          <Popover.Content class="z-popover bg-panel border border-edge-muted rounded-md shadow-lg p-1 flex flex-col gap-1">
            <For each={MORE_VIEWS}>
              {(item) => (
                <button
                  type="button"
                  class="flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-hover text-ink"
                  onClick={() => {
                    impactFeedback('light');
                    props.onNavigate(item.id);
                    setOpen(false);
                  }}
                >
                  <div class="w-4 h-4 shrink-0 [&_svg]:size-4">
                    <Dynamic component={item.icon} />
                  </div>
                  <span>{item.label}</span>
                </button>
              )}
            </For>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </>
  );
}

export function MobileDock() {
  const { openWithSplit } = useSplitLayout();
  const layoutManager = globalSplitManager();

  const activeId = () => layoutManager?.activeSplit()?.content()?.id;
  const isActive = (id: ListView) => activeId() === id;
  const isMoreActive = () => MORE_VIEWS.some((v) => v.id === activeId());

  const navigate = (id: ListView) => {
    openWithSplit({ type: 'component', id }, { mergeHistory: true });
  };

  return (
    <div class="flex flex-row justify-between bg-page border-t border-edge-muted">
      <MobileDockButton
        icon={TrayIcon}
        label="Inbox"
        active={isActive('inbox')}
        onClick={() => navigate('inbox')}
      />
      <MobileDockButton
        icon={AnimatedChannelIcon}
        label="Channels"
        active={isActive('channels')}
        onClick={() => navigate('channels')}
      />
      <MobileDockButton
        icon={AnimatedFolderIcon}
        label="Files"
        active={isActive('files')}
        onClick={() => navigate('files')}
      />
      <MorePopover active={isMoreActive()} onNavigate={navigate} />
      <MobileDockButton
        icon={SearchIcon}
        label="Search"
        onClick={() => {
          SearchState.maybeResetState();
          SearchState.open();
        }}
      />
    </div>
  );
}
