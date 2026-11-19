import { HomeView } from '@app/features/home/home-view';
import { useNewHomeTitle } from './new-home-navigation';
import { NewHomeTabBar } from './new-home-tab-bar';

/** New Home's Recent tab: Home's list of the viewer's own recent work. */
export function NewHomeRecentView() {
  const title = useNewHomeTitle();
  return (
    <HomeView
      tab="recent"
      frame={{ title, tabs: () => <NewHomeTabBar tab="recent" /> }}
    />
  );
}
