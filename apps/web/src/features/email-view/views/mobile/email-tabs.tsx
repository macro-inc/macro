import { ViewSidebar } from '@app/components/view-shell';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { Show } from 'solid-js';
import {
  EMAIL_INBOX_TAB_IDS,
  EMAIL_TAB_LABELS,
  emailShownViewTitle,
} from '../../constants';
import { useEmailView } from '../../email-view-context';
import { useVisibleEmailTab } from '../../use-visible-email-tab';

/** The Inbox's pills on touch; any other view, or a search, shows its name. */
export function EmailMobileTabs() {
  const isVisible = useVisibleEmailTab();
  const { state, setTab, shownTab, showsInboxTabs, tagViewTitle } =
    useEmailView();
  const tabs = () =>
    showsInboxTabs()
      ? EMAIL_INBOX_TAB_IDS.filter(isVisible).map((id) => ({
          value: id,
          label: EMAIL_TAB_LABELS[id],
        }))
      : [];

  return (
    <PillTabs
      scrollable
      class="-ml-(--mobile-chrome-gutter) min-w-0 flex-1"
      contentClass="px-(--mobile-chrome-gutter)"
      leading={<ViewSidebar.Toggle action="expand" presentation="pill" />}
      items={tabs()}
      trailing={
        <Show when={!showsInboxTabs()}>
          <MobileHeader.Island>
            <span class="truncate text-sm font-medium">
              {tagViewTitle() ?? emailShownViewTitle(shownTab())}
            </span>
          </MobileHeader.Island>
        </Show>
      }
      value={state.tab}
      onChange={setTab}
    />
  );
}
