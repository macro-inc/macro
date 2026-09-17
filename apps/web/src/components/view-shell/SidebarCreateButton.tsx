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
      <div class="min-w-0 px-2 pt-2 touch:pt-[calc(var(--safe-top,0px)+0.5rem)]">
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
    <ViewSidebar.Action
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
    </ViewSidebar.Action>
  );
}
