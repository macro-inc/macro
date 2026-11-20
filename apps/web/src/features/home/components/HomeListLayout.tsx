import { ViewSidebar } from '@app/components/view-shell';
import { MobileListLayout } from '@app/components/view-shell/MobileListLayout';
import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { tourTarget } from '@ui/components/Tour';
import { createSignal, type JSX, type ParentProps, Show } from 'solid-js';
import { useHomeView } from '../home-view-context';
import { HOME_TOUR } from '../tour';
import { HomeFilterDropdown } from './HomeFilters';
import type { HomeListWidth } from './HomeViewLayout';

/** New Home's frame around Home's list: its name and its tabs. */
export type HomeFrame = {
  /** "New Home" while old Home is still beside it, else "Home". */
  title: () => string;
  /** The Recent and Notifications switch, under the header. */
  tabs: () => JSX.Element;
  /** The list width both of New Home's tabs share. */
  list: HomeListWidth;
};

function DesktopHomeHeader(props: {
  frame?: HomeFrame;
  onNewChat: () => void;
}) {
  const { state, setState, focusList } = useHomeView();
  // A query on the list keeps its field on screen, also when the header
  // remounts, and closing the field clears the query, as in the list headers.
  const [searchOpened, setSearchOpened] = createSignal(
    state.search.trim().length > 0
  );
  const searchOpen = () => searchOpened() || state.search.trim().length > 0;
  // New Home's copy is translated; old Home's stays as it was.
  const searchLabel = () => (props.frame ? t('home.search') : 'Search Home');
  return (
    <>
      <SidebarCreateHeader
        title={props.frame?.title() ?? 'Home'}
        label={props.frame ? t('home.newChat') : 'New chat'}
        createText={props.frame ? t('home.newChat') : undefined}
        onCreate={props.onNewChat}
        actions={<HomeFilterDropdown />}
        searchLabel={searchLabel()}
        searchOpen={searchOpen()}
        onSearchOpenChange={(open) => {
          setSearchOpened(open);
          if (!open) setState('search', '');
        }}
        search={() => (
          <ViewSidebar.Search
            label={searchLabel()}
            value={state.search}
            onValueChange={(search) => setState('search', search)}
            focusResults={() => {
              focusList();
            }}
          />
        )}
      />
      {props.frame?.tabs()}
    </>
  );
}

/** Keep mobile chrome above a full-height list so rows fade beneath it. */
export function HomeListLayout(
  props: ParentProps<{
    frame?: HomeFrame;
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
            <DesktopHomeHeader
              frame={props.frame}
              onNewChat={props.onNewChat}
            />
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
