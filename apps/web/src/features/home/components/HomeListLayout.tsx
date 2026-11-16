import { SearchBar } from '@app/components/view-shell';
import { MobileListLayout } from '@app/components/view-shell/MobileListLayout';
import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { tourTarget } from '@ui/components/Tour';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { useHomeView } from '../home-view-context';
import { HOME_TOUR } from '../tour';
import { HomeFilterDropdown } from './HomeFilters';

function DesktopHomeHeader(props: { onNewChat: () => void }) {
  const { state, setState } = useHomeView();
  return (
    <SidebarCreateHeader
      title="Home"
      label="New chat"
      onCreate={props.onNewChat}
      actions={<HomeFilterDropdown />}
      searchLabel="Search Home"
      search={() => (
        <SearchBar
          label="Search Home"
          placeholder="Search Home"
          value={state.search}
          onValueChange={(search) => setState('search', search)}
        />
      )}
    />
  );
}

/** Keep mobile chrome above a full-height list so rows fade beneath it. */
export function HomeListLayout(
  props: ParentProps<{
    tabs: JSX.Element;
    onNewChat: () => void;
    /** Below the list on desktop, e.g. the setup prompt. */
    footer?: JSX.Element;
  }>
) {
  return (
    <div
      ref={tourTarget(HOME_TOUR.list)}
      class="relative flex size-full min-h-0 min-w-0 flex-col"
    >
      <Show
        when={isTouchDevice()}
        fallback={
          <>
            <DesktopHomeHeader onNewChat={props.onNewChat} />
            {props.children}
            {props.footer}
          </>
        }
      >
        <MobileListLayout header={props.tabs}>
          {props.children}
        </MobileListLayout>
      </Show>
    </div>
  );
}
