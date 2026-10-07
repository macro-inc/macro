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
        <SidebarBigCreateButton label={props.label} onCreate={props.onCreate} />
      </ViewSidebar.Primary>
    </header>
  );
}

export function SidebarCreateButton(props: {
  label: string;
  onCreate: () => void;
  ref?: (element: HTMLElement) => void;
}) {
  return (
    <ViewSidebar.Action
      ref={props.ref}
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

/** The large "New" tile that tops a sidebar, so first-time users see how to create. */
export function SidebarBigCreateButton(props: {
  label: string;
  onCreate: () => void;
  ref?: (element: HTMLElement) => void;
}) {
  return (
    <ViewSidebar.BigAction
      ref={props.ref}
      {...pressHandlers((event) => {
        event.preventDefault();
        props.onCreate();
      })}
    >
      <PlusIcon class="size-6 text-accent" />
      <span class="truncate">{props.label}</span>
    </ViewSidebar.BigAction>
  );
}
