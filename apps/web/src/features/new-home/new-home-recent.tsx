import { HomeView } from '@app/features/home/home-view';
import { NEW_HOME_LIST, seedNewHomeListWidth } from './new-home-list';
import { useNewHomeTitle } from './new-home-navigation';
import { NewHomeTabBar } from './new-home-tab-bar';

/** New Home's Recent tab: Home's list of the viewer's own recent work. */
export function NewHomeRecentView() {
  seedNewHomeListWidth();
  const title = useNewHomeTitle();
  return (
    <HomeView
      tab="recent"
      frame={{
        title,
        tabs: () => <NewHomeTabBar tab="recent" />,
        list: NEW_HOME_LIST,
      }}
    />
  );
}
