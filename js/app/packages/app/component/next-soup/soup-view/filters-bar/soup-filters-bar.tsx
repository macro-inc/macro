import { useAnalytics } from '@app/component/analytics-context';
import { ActiveFilterChips } from '@app/component/next-soup/soup-view/filters-bar/active-filter-chips';
import { SoupViewContextGroup } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { UnifiedFilterDropdown } from '@app/component/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/component/next-soup/soup-view/filters-bar/use-filter-refinements';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import EyeSlashIcon from '@phosphor-icons/core/regular/eye-slash.svg?component-solid';
import { Button, Tooltip } from '@ui';
import { createMemo, Show } from 'solid-js';
import { useSoup } from '../../soup-context';

export const SoupFiltersBar = () => {
  const {
    resetToTabDefaults,
    activeFiltersList,
    removeFilter,
    replaceFilter,
    isOptionActive,
  } = useFilterRefinements();

  const analytics = useAnalytics();

  const soup = useSoup();
  const panel = useSplitPanelOrThrow();

  const togglePreview = () => {
    const currentPreview = soup.previewEntity();
    if (currentPreview) {
      soup.setPreviewEntity(undefined);
      return;
    }

    const focused = soup.focus.id();

    if (!focused) return;

    analytics.track('preview_panel_use');
    soup.setPreviewEntity(focused);
  };

  registerHotkey({
    hotkey: 'space',
    scopeId: panel.splitHotkeyScope,
    description: 'Toggle preview',
    hotkeyToken: TOKENS.unifiedList.togglePreview,
    keyDownHandler: () => {
      togglePreview();
      return true;
    },
  });

  const isSearchView = createMemo(() => {
    const content = panel.handle.content();
    return content.type === 'component' && content.id === 'search';
  });

  return (
    <Show when={!isMobile()}>
      <SplitToolbarLeft>
        <div class="flex items-start gap-2 min-w-0 flex-1">
          <UnifiedFilterDropdown />
          <ActiveFilterChips
            filters={activeFiltersList()}
            onRemove={removeFilter}
            onReplace={replaceFilter}
            onClearAll={resetToTabDefaults}
            isOptionActive={isOptionActive}
          />
        </div>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <Tooltip label="Preview" hotkey={TOKENS.unifiedList.togglePreview}>
          <Button variant="ghost" size="icon-sm" onClick={togglePreview}>
            {soup.previewEntity() ? <EyeSlashIcon /> : <EyeIcon />}
          </Button>
        </Tooltip>
        <Show when={!isSearchView()}>
          <SoupViewContextSort />
          <SoupViewContextGroup />
        </Show>
      </SplitToolbarRight>
    </Show>
  );
};
