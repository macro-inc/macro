import { SearchFiltersRow } from '@app/features/next-soup/soup-view/filters-bar/search/search-filters-row';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
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
}) {
  const { resetToTabDefaults, consolidatedFiltersList } =
    useFilterRefinements();

  const [filterDropdownOpen, setFilterDropdownOpen] = createSignal(false);

  const panel = useSplitPanelOrThrow();

  const isSearchView = createMemo(() => {
    const content = panel.handle.content();
    return content.type === 'component' && content.id === 'search';
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

  return (
    <Show when={!isMobile()}>
      <SplitToolbarLeft>
        <div class="flex items-start gap-1 min-w-0 flex-1">
          <Show
            when={!isSearchView() && !isTagView()}
            fallback={
              <Show when={isTagView()} fallback={<SearchFiltersRow />}>
                <Show when={!isNewInbox()}>
                  <SoupViewContextSort />
                </Show>
                <SoupViewContextGroup />
              </Show>
            }
          >
            <Show when={!isNewInbox()}>
              <SoupViewContextSort />
            </Show>
            <SoupViewContextGroup />
            <UnifiedFilterDropdown
              open={filterDropdownOpen}
              onOpenChange={setFilterDropdownOpen}
            />
          </Show>
        </div>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <PreviewButton
          disabled={!props.hasPreviewItems}
          disabledLabel="No items to preview"
          onEngage={props.onPreviewEngage}
        />
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
