import { SoupViewContextSort } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { SoupSearchbar } from '@app/component/next-soup/soup-view/filters-bar/soup-view-search-bar';
import { useFilterRefinements } from '@app/component/next-soup/soup-view/filters-bar/use-filter-refinements';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { createMemo, createSignal, Match, Switch } from 'solid-js';
import { UnifiedFilterDropdown } from '@app/component/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { ActiveFilterChips } from '@app/component/next-soup/soup-view/filters-bar/active-filter-chips';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { Button } from './button';
import { AnimatedPreviewIcon } from '@macro-icons/wide/animating/preview';
import { useSoup } from '../../soup-context';
import { registerHotkey } from '@core/hotkey/hotkeys';

export const SoupFiltersBar = () => {
  const {
    resetToTabDefaults,
    activeFiltersList,
    removeFilter,
    replaceFilter,
    isOptionActive,
  } = useFilterRefinements();
  const [previewBtnHovering, setPreviewBtnHovering] = createSignal(false);

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

    soup.setPreviewEntity(focused);
  };

  registerHotkey({
    hotkey: 'space',
    scopeId: panel.splitHotkeyScope,
    description: 'Toggle preview',
    keyDownHandler: () => {
      togglePreview();
      return true;
    },
  });

  const component = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return content.id;
  });

  const isComponentListView = (listView: ListView) => {
    return component() === listView;
  };

  return (
    <Switch>
      <Match when={isComponentListView('search')}>
        <div class="w-full flex flex-col gap-2 p-2 border-b border-edge-muted/50">
          <SoupSearchbar autoFocus />
        </div>
      </Match>
      <Match when={true}>
        <div class="flex items-start gap-2 px-2 py-1.5 border-b border-edge-muted/50 w-full">
          <UnifiedFilterDropdown />
          <ActiveFilterChips
            filters={activeFiltersList()}
            onRemove={removeFilter}
            onReplace={replaceFilter}
            onClearAll={resetToTabDefaults}
            isOptionActive={isOptionActive}
          />
          <div class="flex-1" />
          <Tooltip
            tooltip={<LabelAndHotKey label="Preview" shortcut="space" />}
          >
            <Button
              variant={soup.previewEntity() ? 'primary' : 'ghost'}
              size="sm"
              class="rounded-xs [&_svg]:size-4 px-1 border border-transparent"
              onClick={togglePreview}
              onMouseEnter={() => setPreviewBtnHovering(true)}
              onMouseLeave={() => setPreviewBtnHovering(false)}
            >
              <AnimatedPreviewIcon triggerAnimation={previewBtnHovering()} />
            </Button>
          </Tooltip>
          <SoupViewContextSort />
        </div>
      </Match>
    </Switch>
  );
};
