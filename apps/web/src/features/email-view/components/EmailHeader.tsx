import {
  useViewControlHotkeys,
  ViewBreadcrumbs,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Tabs } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { createSignal, Show } from 'solid-js';
import { composeEmail } from '../compose-email';
import { EMAIL_TAB_LABELS, EMAIL_TABS } from '../constants';
import { useEmailView } from '../email-view-context';
import { EMAIL_TOUR } from '../tour';
import { EmailControls } from './EmailControls';

export type EmailHeaderProps = {
  /** Restores list focus when Escape leaves the search field. */
  onSearchEscape?: () => void;
  tabOnly?: boolean;
};

export function EmailViewBreadcrumbItem() {
  const { state } = useEmailView();
  const inboxSelected = () =>
    !isTouchDevice() && (state.tab === 'important' || state.tab === 'noise');
  const tabTitle = () =>
    inboxSelected()
      ? 'Inbox'
      : (EMAIL_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Email');

  return (
    <ViewBreadcrumbs.Item
      value="email-view"
      metadata={{ type: 'email-view' }}
      order={0}
    >
      {(item) => (
        <ViewBreadcrumbs.Button
          class="shrink-0 rounded-md hover:bg-hover"
          isActive={item.isActive()}
          onClick={item.onSelect}
        >
          <span class="truncate @max-[720px]/view-shell:hidden">
            {tabTitle()}
          </span>
          <span class="hidden @max-[720px]/view-shell:inline">
            {inboxSelected() ? 'Inbox' : 'Email'}
          </span>
        </ViewBreadcrumbs.Button>
      )}
    </ViewBreadcrumbs.Item>
  );
}

export function EmailHeader(props: EmailHeaderProps) {
  const panel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();
  const { state, setState, setTab } = useEmailView();
  const [filterOpen, setFilterOpen] = createSignal(false);
  let focusSearch: (() => void) | undefined;
  const searchTarget = tourTarget(EMAIL_TOUR.search);
  const inboxSelected = () =>
    state.tab === 'important' || state.tab === 'noise';
  const selectedTabLabel = () =>
    inboxSelected()
      ? 'Inbox'
      : (EMAIL_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Email');

  const runSearch = () => {
    focusSearch?.();
    return true;
  };
  const canSearch = () =>
    state.tab !== 'scheduled' && state.tab !== 'reminders';

  // Mail clients search with `/`; elsewhere it opens the app's search view.
  registerHotkey({
    hotkey: '/',
    scopeId: panel.splitHotkeyScope,
    description: 'Search email',
    condition: () => panel.isPanelActive() && canSearch(),
    keyDownHandler: runSearch,
  });

  // The view's control hotkeys are registered once, here, for the split scope.
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search email',
      condition: canSearch,
      run: runSearch,
    },
    filter: {
      description: 'Filter email',
      condition: () => state.tab !== 'scheduled',
      run: () => {
        setFilterOpen(true);
        return true;
      },
    },
  });

  return (
    <ListHeader
      title={
        <div class="flex min-w-0 items-center gap-3">
          <div
            class={
              inboxSelected()
                ? 'min-w-0 @max-[640px]/split-header:hidden'
                : 'min-w-0'
            }
          >
            <Show
              when={props.tabOnly}
              fallback={<ViewBreadcrumbs.Outlet aria-label="Email location" />}
            >
              <h2 class="truncate px-1 text-sm font-medium text-ink">
                {selectedTabLabel()}
              </h2>
            </Show>
          </div>
          <Show when={inboxSelected()}>
            <Tabs
              ref={tourTarget(EMAIL_TOUR.signalNoise)}
              aria-label="Inbox view"
              class="shrink-0"
              options={[
                { value: 'important', label: EMAIL_TAB_LABELS.important },
                { value: 'noise', label: EMAIL_TAB_LABELS.noise },
              ]}
              value={state.tab}
              onChange={setTab}
            />
          </Show>
        </div>
      }
    >
      <Show when={state.tab !== 'scheduled'}>
        <EmailControls
          filterOpen={filterOpen()}
          onFilterOpenChange={setFilterOpen}
        />
      </Show>
      <div class="contents @max-[640px]/split-header:hidden">
        <ViewCreateButton
          aria-label="New email"
          onClick={() => composeEmail(openWithSplit, state.inboxIds)}
        />
      </div>
      <Show when={state.tab !== 'reminders' && state.tab !== 'scheduled'}>
        <ListHeaderSearch
          ref={searchTarget}
          label="Search email"
          value={state.search}
          onValueChange={(search) => setState('search', search)}
          onEscape={props.onSearchEscape}
          registerFocus={(focus) => {
            focusSearch = focus;
          }}
        />
      </Show>
    </ListHeader>
  );
}
