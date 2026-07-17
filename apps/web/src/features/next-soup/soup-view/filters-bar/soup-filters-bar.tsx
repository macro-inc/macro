import { SearchFiltersRow } from '@app/features/next-soup/soup-view/filters-bar/search/search-filters-row';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@components/app/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  ENABLE_NEW_INBOX_FLAG,
  ENABLE_NEW_INBOX_OVERRIDE,
} from '@core/constant/featureFlags';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import EyeSlashIcon from '@phosphor-icons/core/regular/eye-slash.svg?component-solid';
import { Button, Tooltip } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';

export function SoupFiltersBar(props: { variant?: 'default' | 'tag' } = {}) {
  const { resetToTabDefaults, consolidatedFiltersList } =
    useFilterRefinements();

  const [filterDropdownOpen, setFilterDropdownOpen] = createSignal(false);

  const panel = useSplitPanelOrThrow();
  const analytics = useAnalytics();

  const previewEngaged = () => panel.handle.isPreviewEngaged();
  const canEngage = () => panel.handle.canEngagePreview();

  const togglePreview = () => {
    if (previewEngaged()) {
      // The viewer split stays open as a normal split; only the link goes.
      panel.handle.disengagePreview();
      return;
    }
    if (!canEngage()) return;

    analytics.track('preview_panel_use');
    // Eagerly opens the viewer split with its empty state and pins this
    // split to its compact width (see engagePreviewMode).
    panel.handle.engagePreview();
  };

  registerHotkey({
    hotkeyToken: TOKENS.unifiedList.togglePreview,
    scopeId: panel.splitHotkeyScope,
    description: 'Toggle preview',
    keyDownHandler: () => {
      togglePreview();
      return true;
    },
    hotkey: 'space',
  });

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
        <Tooltip
          hotkey={canEngage() ? TOKENS.unifiedList.togglePreview : undefined}
          label={canEngage() ? 'Preview' : 'No space for preview'}
        >
          <Button
            onClick={togglePreview}
            variant="base"
            size="sm"
            depth={2}
            class="bg-surface"
            disabled={!canEngage()}
          >
            {previewEngaged() ? <EyeSlashIcon /> : <EyeIcon />}
            <span>Preview</span>
          </Button>
        </Tooltip>
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
