import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import PlusIcon from '@phosphor/plus.svg';
import { pressHandlers } from '@ui';
import { type JSX, Show } from 'solid-js';
import { ViewSidebar } from './ViewSidebar';

export function SidebarCreateHeader(props: {
  title: string;
  label: string;
  onCreate: () => void;
  actions?: JSX.Element;
  titleActions?: JSX.Element;
}) {
  return (
    <header class="flex shrink-0 flex-col">
      <Show when={!isTouchDevice()}>
        <ViewSidebar.Header>
          <div class="flex min-w-0 items-center gap-1">
            <SplitPanel.CloseButton class="shrink-0" />
            <ViewSidebar.Title>{props.title}</ViewSidebar.Title>
            {props.titleActions}
          </div>
          {props.actions}
        </ViewSidebar.Header>
      </Show>
      <div class="min-w-0 px-1.5 pt-4 touch:pt-[calc(var(--safe-top,0px)+1rem)]">
        <SidebarCreateButton label={props.label} onCreate={props.onCreate} />
      </div>
    </header>
  );
}

export function SidebarCreateButton(props: {
  label: string;
  onCreate: () => void;
}) {
  return (
    <button
      type="button"
      class="flex h-9 w-full shrink-0 items-center gap-2 rounded-xl bg-hover px-2.5 text-left text-sm font-medium text-ink-muted hover:bg-active hover:text-ink focus-visible:outline-2 focus-visible:outline-accent touch:h-11"
      {...pressHandlers((event) => {
        event.preventDefault();
        props.onCreate();
      })}
    >
      <span
        aria-hidden="true"
        class="flex size-5 shrink-0 items-center justify-center"
      >
        <PlusIcon class="size-4" />
      </span>
      <span class="truncate">{props.label}</span>
    </button>
  );
}
