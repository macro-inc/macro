import { SearchFiltersRow } from '@app/features/next-soup/soup-view/filters-bar/search/search-filters-row';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import {
  CompanyDisplayMenu,
  CompanyViewsMenu,
} from '@app/features/next-soup/soup-view/views/companies/CompanyViewsMenu';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { CollapsibleToolbarItem } from '@components/app/split-layout/components/CollapsibleItem';
import { PreviewButton } from '@components/app/split-layout/components/PreviewButton';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@components/app/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  ENABLE_NEW_INBOX_FLAG,
  ENABLE_NEW_INBOX_OVERRIDE,
} from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { createMemo, createSignal, Show } from 'solid-js';

export function SoupFiltersBar(props: {
  variant?: 'default' | 'tag';
  hasPreviewItems: boolean;
  onPreviewEngage: () => void;
  onPreviewOpenChange?: (open: boolean) => void;
}) {
  const { resetToTabDefaults, consolidatedFiltersList } =
    useFilterRefinements();

  const [filterDropdownOpen, setFilterDropdownOpen] = createSignal(false);

  const panel = useSplitPanelOrThrow();

  const isSearchView = createMemo(() => {
    const content = panel.handle.content();
    return content.type === 'component' && content.id === 'search';
  });
  const isCompaniesView = createMemo(() => {
    const content = panel.handle.content();
    return content.type === 'component' && content.id === 'companies';
  });
  const isTagView = createMemo(() => props.variant === 'tag');

  // The new inbox hides sort (it's fixed to updated_at for this view).
  const newInboxFlag = useFeatureFlag(ENABLE_NEW_INBOX_FLAG, {
    enabledOverride: ENABLE_NEW_INBOX_OVERRIDE,
  });
  const isNewInbox = createMemo(() => {
    const content = panel.handle.content();
    return (
      content.type === 'component' &&
      content.id === 'inbox' &&
      newInboxFlag().enabled
    );
  });

  const CollapsibleGroup = () => (
    <CollapsibleToolbarItem id="soup-toolbar-group" priority={0}>
      {(isCollapsed) => <SoupViewContextGroup hideLabel={isCollapsed()} />}
    </CollapsibleToolbarItem>
  );

  const CollapsibleFilter = () => (
    <CollapsibleToolbarItem id="soup-toolbar-filter" priority={1}>
      {(isCollapsed) => (
        <UnifiedFilterDropdown
          open={filterDropdownOpen}
          onOpenChange={setFilterDropdownOpen}
          hideLabel={isCollapsed()}
        />
      )}
    </CollapsibleToolbarItem>
  );

  return (
    <Show when={!isMobile()}>
      <SplitToolbarLeft>
        <Show
          when={!isSearchView() && !isTagView()}
          fallback={
            <Show when={isTagView()} fallback={<SearchFiltersRow />}>
              <Show when={!isNewInbox()}>
                <SoupViewContextSort />
              </Show>
              <CollapsibleGroup />
            </Show>
          }
        >
          <Show when={!isNewInbox()}>
            <SoupViewContextSort />
          </Show>
          <CollapsibleGroup />
          <CollapsibleFilter />
          <Show when={isCompaniesView()}>
            <CompanyDisplayMenu />
          </Show>
        </Show>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <Show when={isCompaniesView()}>
          <CollapsibleToolbarItem id="soup-toolbar-views" priority={2}>
            {(isCollapsed) => <CompanyViewsMenu hideLabel={isCollapsed()} />}
          </CollapsibleToolbarItem>
        </Show>
        <CollapsibleToolbarItem id="soup-toolbar-preview" priority={3}>
          {(isCollapsed) => (
            <PreviewButton
              disabled={!props.hasPreviewItems}
              disabledLabel="No items to preview"
              onEngage={props.onPreviewEngage}
              onOpenChange={props.onPreviewOpenChange}
              hideLabel={isCollapsed()}
            />
          )}
        </CollapsibleToolbarItem>
      </SplitToolbarRight>
      {/* Active filters bar - shown below the toolbar when there are filters */}
      <Show when={!isSearchView() && !isTagView()}>
        <SoupActiveFiltersBar
          filters={consolidatedFiltersList()}
          onClearAll={resetToTabDefaults}
        />
      </Show>
    </Show>
  );
}
