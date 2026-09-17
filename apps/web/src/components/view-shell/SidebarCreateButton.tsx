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
            <ViewSidebar.CloseButton class="shrink-0" />
            <ViewSidebar.Title>{props.title}</ViewSidebar.Title>
            {props.titleActions}
          </div>
          {props.actions}
        </ViewSidebar.Header>
      </Show>
      <ViewSidebar.Primary>
        <SidebarCreateButton label={props.label} onCreate={props.onCreate} />
      </ViewSidebar.Primary>
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
      <ViewSidebar.Icon>
        <PlusIcon class="size-4" />
      </ViewSidebar.Icon>
      <span class="truncate">{props.label}</span>
    </ViewSidebar.Action>
  );
}
