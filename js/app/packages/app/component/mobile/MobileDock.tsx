import WideChannel from '@macro-icons/wide/channel.svg';
import WideEmail from '@macro-icons/wide/email.svg';
import WideCode from '@macro-icons/wide/file-code.svg';
import WidePlus from '@macro-icons/wide/plus.svg';
import WideTask from '@macro-icons/wide/task.svg';
import type { Component, JSX } from 'solid-js';
import { setCreateMenuOpen } from '../Launcher';
import { useSplitPanelOrThrow } from '../split-layout/layoutUtils';
import { VIEWCONFIG_DEFAULTS_IDS_ENUM } from '../ViewConfig';

type MobileDockButtonProps = {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  label: string;
  onClick: () => void;
  active?: boolean;
};

function MobileDockButton(props: MobileDockButtonProps) {
  return (
    <button
      onClick={props.onClick}
      class="flex flex-col items-center justify-center w-[20%] py-4"
      classList={{
        'text-ink-muted': !props.active,
        'text-ink bg-panel': props.active,
      }}
    >
      <props.icon class="w-6 h-6" />
      <span class="text-xs">{props.label}</span>
    </button>
  );
}

export function MobileDock() {
  const splitContext = useSplitPanelOrThrow();
  const { selectedView, setSelectedView } = splitContext.unifiedListContext;

  const ensureUnifiedList = () => {
    const content = splitContext.handle.content();
    if (content.type === 'component' && content.id === 'unified-list') return;
    splitContext.handle.replace({ type: 'component', id: 'unified-list' });
  };

  const focusSearchInput = (viewId: string) => {
    setTimeout(() => {
      const el = document.getElementById(
        `search-input-${splitContext.handle.id}-${viewId}`
      );
      if (el instanceof HTMLInputElement) {
        el.focus();
      } else {
        (el as HTMLElement | null)?.focus?.();
      }
    }, 0);
  };

  return (
    <div class="flex flex-row justify-between bg-linear-to-t from-page to-panel border-t border-edge-muted">
      <MobileDockButton
        icon={WideCode}
        label="Search"
        active={selectedView() === VIEWCONFIG_DEFAULTS_IDS_ENUM.all}
        onClick={() => {
          ensureUnifiedList();
          setSelectedView(VIEWCONFIG_DEFAULTS_IDS_ENUM.all);
          focusSearchInput(VIEWCONFIG_DEFAULTS_IDS_ENUM.all);
        }}
      />
      <MobileDockButton
        icon={WideEmail}
        label="Inbox"
        active={selectedView() === VIEWCONFIG_DEFAULTS_IDS_ENUM.signal}
        onClick={() => {
          ensureUnifiedList();
          setSelectedView(VIEWCONFIG_DEFAULTS_IDS_ENUM.signal);
        }}
      />
      <MobileDockButton
        icon={WideChannel}
        label="People"
        active={selectedView() === VIEWCONFIG_DEFAULTS_IDS_ENUM.people}
        onClick={() => {
          ensureUnifiedList();
          setSelectedView(VIEWCONFIG_DEFAULTS_IDS_ENUM.people);
        }}
      />
      <MobileDockButton
        icon={WideTask}
        label="Tasks"
        active={selectedView() === VIEWCONFIG_DEFAULTS_IDS_ENUM.tasks}
        onClick={() => {
          ensureUnifiedList();
          setSelectedView(VIEWCONFIG_DEFAULTS_IDS_ENUM.tasks);
        }}
      />
      <MobileDockButton
        icon={WidePlus}
        label="Create"
        onClick={() => {
          setCreateMenuOpen(true);
        }}
      />
    </div>
  );
}
