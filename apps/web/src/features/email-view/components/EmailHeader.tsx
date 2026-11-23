import {
  useViewControlHotkeys,
  useViewTabHotkeys,
  ViewBreadcrumbs,
  ViewSwitchTrigger,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createLabelCollapse } from '@core/signal/create-label-collapse';
import { Tabs } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { createSignal, onCleanup, Show } from 'solid-js';
import { composeEmail } from '../compose-email';
import {
  canSearchEmailTab,
  EMAIL_INBOX_TAB_IDS,
  EMAIL_TAB_LABELS,
  EMAIL_TABS,
  isEmailInboxTab,
} from '../constants';
import { useEmailView } from '../email-view-context';
import type { EmailSearchSuggestions } from '../search/create-email-search-suggestions';
import {
  EMAIL_SEARCH_SCOPE_IDS,
  editEmailSearchField,
  formatEmailSearch,
  splitEmailSearchField,
} from '../search/email-search-scope';
import { useEmailSearchScopeAvailability } from '../tab-availability';
import type { EmailTab } from '../tabs';
import { EMAIL_TOUR } from '../tour';
import { useVisibleEmailTab } from '../use-visible-email-tab';
import {
  EmailSavedViewActions,
  EmailSavedViewMenu,
  EmailSaveViewButton,
  useEmailSavedViewTitle,
} from '../views/email-saved-views';
import { EmailControls } from './EmailControls';
import { EmailSearchScopeChip } from './EmailSearchScopeChip';

/** What the header gives up, in order, when its actions would overflow it. */
const HEADER_COLLAPSE_ORDER = ['viewOptions'] as const;

export type EmailHeaderProps = {
  /** Moves the keyboard from the search field into the list. */
  focusSearchResults?: () => void;
  /** Hands the search field's focus to the view's search keys. */
  registerSearch?: (focus: () => void) => () => void;
  /**
   * The wide search: the open field takes over the header and lists recent
   * searches. Absent, the field stays compact beside the other actions.
   */
  searchSuggestions?: EmailSearchSuggestions;
  tabOnly?: boolean;
};

export function EmailViewBreadcrumbItem() {
  const { state, tagViewTitle, savedViewActive, savedViews } = useEmailView();
  const savedViewTitle = useEmailSavedViewTitle();
  const inboxSelected = () =>
    !isTouchDevice() && !savedViewActive() && isEmailInboxTab(state.tab);
  const tabTitle = () =>
    savedViewTitle() ??
    tagViewTitle() ??
    (inboxSelected()
      ? 'Inbox'
      : (EMAIL_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Email'));
  const appearance = () => {
    const view = savedViews?.view();
    return view?.kind === 'saved' ? view.record.appearance : undefined;
  };

  return (
    <ViewBreadcrumbs.Item
      value="email-view"
      metadata={{ type: 'email-view' }}
      order={0}
    >
      {(item) => {
        const label = () => (
          <>
            <Show when={savedViewActive()}>
              <EntityIcon
                targetType="saved_view"
                appearance={appearance()}
                size="xs"
              />
            </Show>
            <span class="truncate @max-[720px]/view-shell:hidden">
              {tabTitle()}
            </span>
            <span class="hidden @max-[720px]/view-shell:inline">
              {inboxSelected() ? 'Inbox' : 'Email'}
            </span>
          </>
        );
        const button = () => (
          <ViewBreadcrumbs.Button
            class="shrink-0 gap-2 rounded-md hover:bg-hover"
            isActive={item.isActive()}
            onClick={item.onSelect}
          >
            {label()}
          </ViewBreadcrumbs.Button>
        );
        // At the list itself the name switches views; deeper, it returns here.
        return (
          <Show when={item.isActive()} fallback={button()}>
            <ViewSwitchTrigger fallback={button()}>{label()}</ViewSwitchTrigger>
          </Show>
        );
      }}
    </ViewBreadcrumbs.Item>
  );
}

export function EmailHeader(props: EmailHeaderProps) {
  const panel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();
  const {
    state,
    setState,
    setTab,
    shownTab,
    tagViewTitle,
    savedViewActive,
    savedViews,
  } = useEmailView();
  const savedViewTitle = useEmailSavedViewTitle();
  const [filterOpen, setFilterOpen] = createSignal(false);
  // A search of all mail, or of the whole Inbox, selects none of its tabs.
  const shownInboxTab = () => {
    const tab = shownTab();
    return tab !== undefined && tab !== 'inbox' && isEmailInboxTab(tab)
      ? tab
      : undefined;
  };
  let releaseSearch: (() => void) | undefined;
  const searchTarget = tourTarget(EMAIL_TOUR.search);
  const isVisible = useVisibleEmailTab();
  const inboxSelected = () => !savedViewActive() && isEmailInboxTab(state.tab);
  const inboxTabs = () =>
    EMAIL_INBOX_TAB_IDS.filter(isVisible).map((id) => ({
      value: id,
      label: EMAIL_TAB_LABELS[id],
    }));
  const [inboxTabsElement, setInboxTabsElement] = createSignal<HTMLElement>();
  // A narrow pane (the desktop window has no minimum width) hides the view
  // options, the Focus sort and the reading pane toggle, rather than push
  // Search past the header's edge. The reading pane has no room beside the
  // list there anyway, and Shift+V still toggles it.
  const [actions, setActions] = createSignal<HTMLDivElement>();
  const collapsed = createLabelCollapse(actions, () => HEADER_COLLAPSE_ORDER, {
    watchContent: true,
  });

  useViewTabHotkeys<EmailTab>({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    tabs: inboxTabsElement,
    ids: () => inboxTabs().map((tab) => tab.value),
    activeId: () => state.tab,
    setActiveId: setTab,
    label: (id) => EMAIL_TAB_LABELS[id],
  });
  const selectedTabLabel = () =>
    savedViewTitle() ??
    tagViewTitle() ??
    (inboxSelected()
      ? 'Inbox'
      : (EMAIL_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Email'));

  const canSearch = () => canSearchEmailTab(state.tab);
  const scopeAvailable = useEmailSearchScopeAvailability();
  // The wide field shows an `in:` filter as a chip; the compact one as text.
  const field = () =>
    props.searchSuggestions
      ? splitEmailSearchField(state.search)
      : { scope: undefined, text: state.search };
  const removeScope = () => setState('search', field().text);
  // Backspace at the start of the text takes the chip back off.
  const removesScope = (event: KeyboardEvent) =>
    event.key === 'Backspace' &&
    field().scope !== undefined &&
    event.target instanceof HTMLInputElement &&
    event.target.selectionStart === 0 &&
    event.target.selectionEnd === 0;
  const savedAppearance = () => {
    const view = savedViews?.view();
    return view?.kind === 'saved' ? view.record.appearance : undefined;
  };

  onCleanup(() => releaseSearch?.());

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    filter: {
      description: 'Filter email',
      condition: () => state.tab !== 'scheduled',
      run: () => {
        setFilterOpen(true);
        return true;
      },
    },
  });

  // The filter menu is unmounted with the other actions, so the search only
  // takes the header while it is closed.
  const searchOwnsHeader = () =>
    !!props.searchSuggestions?.open() && canSearch() && !filterOpen();

  return (
    <ListHeader
      actionsRef={setActions}
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
              <h2 class="flex min-w-0 items-center gap-2 px-1 text-sm font-medium text-ink">
                <Show when={savedViewActive()}>
                  <EntityIcon
                    targetType="saved_view"
                    appearance={savedAppearance()}
                    size="xs"
                  />
                </Show>
                <span class="truncate">{selectedTabLabel()}</span>
              </h2>
            </Show>
          </div>
          <Show when={savedViewActive()}>
            <EmailSavedViewMenu />
          </Show>
          <Show when={inboxSelected()}>
            <Tabs
              ref={(element) => {
                setInboxTabsElement(element);
                tourTarget(EMAIL_TOUR.signalNoise)(element);
              }}
              aria-label="Inbox view"
              size="md"
              class="shrink-0"
              options={inboxTabs()}
              value={shownInboxTab()}
              onChange={setTab}
            />
          </Show>
        </div>
      }
    >
      <Show when={!searchOwnsHeader()}>
        <EmailSavedViewActions />
        <EmailSaveViewButton />
        <Show when={state.tab !== 'scheduled'}>
          <EmailControls
            filterOpen={filterOpen()}
            onFilterOpenChange={setFilterOpen}
            hideViewOptions={collapsed('viewOptions')}
          />
        </Show>
        <div class="contents @max-[640px]/split-header:hidden">
          <ViewCreateButton
            aria-label="New email"
            onClick={() => composeEmail(openWithSplit, state.inboxIds)}
          />
        </div>
      </Show>
      <Show when={canSearch()}>
        <ListHeaderSearch
          ref={searchTarget}
          label="Search email"
          placeholder={t('emailViews.searchAllMail')}
          value={field().text}
          onValueChange={(text) =>
            setState('search', editEmailSearchField(field().scope, text))
          }
          onClear={() => setState('search', '')}
          leading={
            <Show when={field().scope}>
              {(scope) => (
                <EmailSearchScopeChip
                  scope={scope()}
                  menu={{
                    options: EMAIL_SEARCH_SCOPE_IDS.filter(scopeAvailable),
                    onChange: (next) =>
                      setState('search', formatEmailSearch(next, field().text)),
                  }}
                  onRemove={removeScope}
                />
              )}
            </Show>
          }
          onKeyDown={(event) => {
            if (removesScope(event)) {
              event.preventDefault();
              removeScope();
            }
          }}
          focusResults={props.focusSearchResults}
          wide={!!props.searchSuggestions}
          onOpenChange={props.searchSuggestions?.setOpen}
          onFocusChange={props.searchSuggestions?.setFocused}
          suggestions={props.searchSuggestions}
          registerFocus={(focus) => {
            releaseSearch = props.registerSearch?.(focus);
          }}
        />
      </Show>
    </ListHeader>
  );
}
