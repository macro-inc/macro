import { useAnalytics } from '@app/component/analytics-context';
import { ActiveFilterChips } from '@app/component/next-soup/soup-view/filters-bar/active-filter-chips';
import { SoupViewContextGroup } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { UnifiedFilterDropdown } from '@app/component/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/component/next-soup/soup-view/filters-bar/use-filter-refinements';
import { SplitToolbarLeft } from '@app/component/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import EyeSlashIcon from '@phosphor-icons/core/regular/eye-slash.svg?component-solid';
import { Button, Tooltip } from '@ui';
import { createMemo, Show } from 'solid-js';
import { useSoup } from '../../soup-context';

export function SoupFiltersBar() {
  const {
    resetToTabDefaults,
    activeFiltersList,
    isOptionActive,
    replaceFilter,
    removeFilter,
  } = useFilterRefinements();

  const panel = useSplitPanelOrThrow();
  const analytics = useAnalytics();
  const soup = useSoup();

  const togglePreview = () => {
    const currentPreview = soup.previewEntity();
    if (currentPreview) {
      soup.setPreviewEntity(undefined);
      return;
    }
    const focused = soup.focus.id();
    if (!focused) {
      return;
    }
    analytics.track('preview_panel_use');
    soup.setPreviewEntity(focused);
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

  return (
    <Show when={!isMobile()}>
      <SplitToolbarLeft>
        <div class="flex items-start gap-2 min-w-0 flex-1">
          <Tooltip hotkey={TOKENS.unifiedList.togglePreview} label="Preview">
            <Button
              onClick={togglePreview}
              variant="base"
              size="sm"
              depth={2}
              class="bg-surface"
            >
              {soup.previewEntity() ? <EyeSlashIcon /> : <EyeIcon />}
              <span>Preview</span>
            </Button>
          </Tooltip>
          <Show when={!isSearchView()}>
            <SoupViewContextSort />
            <SoupViewContextGroup />
          </Show>
          <UnifiedFilterDropdown />
          <ActiveFilterChips
            isOptionActive={isOptionActive}
            onClearAll={resetToTabDefaults}
            filters={activeFiltersList()}
            onReplace={replaceFilter}
            onRemove={removeFilter}
          />
        </div>
      </SplitToolbarLeft>
    </Show>
  );
}
