import { SidebarCreateAction } from '@app/components/view-shell/SidebarCreateAction';
import PlusIcon from '@icon/system/regular/plus.svg';
import { pressHandlers } from '@ui';
import type { JSX } from 'solid-js';
import { SearchBar } from './SearchBar';
import { SidebarActionRow } from './SidebarActionRow';
import { ViewSidebar } from './ViewSidebar';

export function SidebarCreateHeader(props: {
  title: string;
  label: string;
  onCreate: () => void;
  actions?: JSX.Element;
  titleActions?: JSX.Element;
  search?: JSX.Element;
}) {
  return (
    <SidebarActionRow
      title={props.title}
      search={
        props.search ?? (
          <SearchBar
            label={`Search ${props.title}`}
            placeholder={`Search ${props.title}`}
            value=""
            onValueChange={() => {}}
            disabled
          />
        )
      }
      titleActions={props.titleActions}
      actions={props.actions}
      create={() => (
        <SidebarCreateAction label={props.label} onClick={props.onCreate}>
          New
        </SidebarCreateAction>
      )}
    />
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
