import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { createMemo, onCleanup, onMount } from 'solid-js';
import {
  commandCategoryIndex,
  searchCategories,
  setCommandCategoryIndex,
} from './KonsoleItem';
import { konsoleOpen } from './state';

export function KonsoleFilter() {
  const visibleCategories = createMemo(() => {
    return searchCategories
      .listVisible()
      .map((category, index) => {
        if (searchCategories.isCategoryActive(index)) {
          return category.name;
        }
        return null;
      })
      .filter(Boolean) as string[];
  });

  const selectedCategoryName = createMemo(() => {
    const categories = searchCategories.listVisible();
    const index = commandCategoryIndex();
    if (index >= 0 && index < categories.length) {
      return categories[index].name;
    }
    return categories[0]?.name || '';
  });

  const handleCategoryChange = (categoryName: string) => {
    const index = searchCategories
      .listVisible()
      .findIndex((cat) => cat.name === categoryName);
    if (index !== -1) {
      setCommandCategoryIndex(index);
    }
  };

  onMount(() => {
    const down = (e: KeyboardEvent) => {
      if (!konsoleOpen()) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        setCommandCategoryIndex((prev) => {
          let nextCategoryIndex = -1;
          if (e.shiftKey) {
            nextCategoryIndex = searchCategories.findNextCategoryIndex(
              prev,
              true
            );
          } else {
            nextCategoryIndex = searchCategories.findNextCategoryIndex(
              prev,
              false
            );
          }
          return Math.max(nextCategoryIndex, 0);
        });
      }
    };

    document.addEventListener('keydown', down);
    onCleanup(() => {
      document.removeEventListener('keydown', down);
    });
  });

  return (
    <div class="flex items-center bg-transparent border-b px-2 border-edge-muted/50 h-[40px]">
      <SegmentedControl
        onChange={handleCategoryChange}
        value={selectedCategoryName()}
        list={visibleCategories()}
        size="SM"
      />
    </div>
  );
}
