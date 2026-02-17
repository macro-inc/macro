import { type Accessor, createEffect, createSignal } from 'solid-js';
import { useKeyPressed } from '@core/util/useKeyPressed';

type UseDropdownSearchOptions = {
  itemCount: Accessor<number>;
  onSelect: (index: number) => void;
  onClose: () => void;
};

export const useDropdownSearch = (options: UseDropdownSearchOptions) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const keyboardMode = useKeyPressed(100);

  createEffect(() => {
    const count = options.itemCount();
    if (count === 0) {
      setSelectedIndex(0);
    } else {
      setSelectedIndex((prev) => Math.min(prev, count - 1));
    }
  });

  const shouldShowHotkeys = () =>
    !searchQuery().trim() && options.itemCount() <= 9;

  const handleKeyDown = (e: KeyboardEvent) => {
    const count = options.itemCount();
    if (count === 0) return;

    if (shouldShowHotkeys() && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (idx < count) options.onSelect(idx);
      return;
    }

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % count);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + count) % count);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      options.onSelect(selectedIndex());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      options.onClose();
    }
  };

  const reset = () => {
    setSelectedIndex(0);
    setSearchQuery('');
  };

  return {
    searchQuery,
    setSearchQuery,
    selectedIndex,
    setSelectedIndex,
    keyboardMode,
    shouldShowHotkeys,
    handleKeyDown,
    reset,
  };
};
