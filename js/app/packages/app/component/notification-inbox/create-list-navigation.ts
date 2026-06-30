import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  untrack,
} from 'solid-js';

type KeyBehavior = 'activate' | 'select' | 'none';

type CreateListNavigationOptions<T> = {
  items: Accessor<readonly T[]>;
  getKey: (item: T) => string;
  selectedKey?: Accessor<string | undefined>;
  onSelect?: (item: T, key: string) => void;
  onActivate?: (item: T, key: string, event?: Event) => void;
  isDisabled?: (item: T) => boolean;
  focusFallback?: 'selected' | 'first' | 'none';
  loop?: boolean;
  scrollToKey?: (key: string) => void;
  enterBehavior?: KeyBehavior;
  spaceBehavior?: KeyBehavior;
};

export function createListNavigation<T>(
  options: CreateListNavigationOptions<T>
) {
  const [focusedKey, setFocusedKey] = createSignal<string>();
  const [internalSelectedKey, setInternalSelectedKey] = createSignal<string>();

  const enabledItems = createMemo(() =>
    options.items().filter((item) => !options.isDisabled?.(item))
  );

  const keys = createMemo(() => enabledItems().map(options.getKey));

  const itemByKey = createMemo(() => {
    const map = new Map<string, T>();
    for (const item of options.items()) {
      map.set(options.getKey(item), item);
    }
    return map;
  });

  const selectedKey = () => options.selectedKey?.() ?? internalSelectedKey();

  const focusedItem = createMemo(() => {
    const key = focusedKey();
    return key ? itemByKey().get(key) : undefined;
  });

  const selectedItem = createMemo(() => {
    const key = selectedKey();
    return key ? itemByKey().get(key) : undefined;
  });

  const setFocus = (key: string | undefined, opts?: { scroll?: boolean }) => {
    if (key && !itemByKey().has(key)) return;
    setFocusedKey(key);
    if (key && opts?.scroll !== false) options.scrollToKey?.(key);
  };

  const selectKey = (key: string | undefined) => {
    if (!key) {
      if (!options.selectedKey) setInternalSelectedKey(undefined);
      return;
    }

    const item = itemByKey().get(key);
    if (!item || options.isDisabled?.(item)) return;

    if (!options.selectedKey) setInternalSelectedKey(key);
    options.onSelect?.(item, key);
  };

  const selectItem = (item: T) => selectKey(options.getKey(item));

  const activateKey = (key: string | undefined, event?: Event) => {
    if (!key) return;

    const item = itemByKey().get(key);
    if (!item || options.isDisabled?.(item)) return;

    options.onActivate?.(item, key, event);
  };

  const activateFocused = (event?: Event) => activateKey(focusedKey(), event);

  const focusIndex = (index: number) => {
    const allKeys = keys();
    const key = allKeys[index];
    if (!key) return;
    setFocus(key);
  };

  const moveFocus = (delta: 1 | -1) => {
    const allKeys = keys();
    if (!allKeys.length) return;

    const currentKey = focusedKey() ?? selectedKey();
    const currentIndex = currentKey ? allKeys.indexOf(currentKey) : -1;
    let nextIndex = currentIndex + delta;

    if (nextIndex < 0) {
      nextIndex = options.loop ? allKeys.length - 1 : 0;
    } else if (nextIndex >= allKeys.length) {
      nextIndex = options.loop ? 0 : allKeys.length - 1;
    }

    focusIndex(nextIndex);
  };

  const focusFirst = () => focusIndex(0);
  const focusLast = () => focusIndex(keys().length - 1);

  const runBehavior = (behavior: KeyBehavior, event: KeyboardEvent) => {
    if (behavior === 'none') return;

    event.preventDefault();
    const key = focusedKey() ?? selectedKey();

    if (behavior === 'select') {
      selectKey(key);
      return;
    }

    activateKey(key, event);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'Home':
        event.preventDefault();
        focusFirst();
        break;
      case 'End':
        event.preventDefault();
        focusLast();
        break;
      case 'Enter':
        runBehavior(options.enterBehavior ?? 'activate', event);
        break;
      case ' ':
        runBehavior(options.spaceBehavior ?? 'select', event);
        break;
    }
  };

  createEffect(() => {
    const allKeys = keys();
    const currentFocusedKey = focusedKey();
    if (currentFocusedKey && allKeys.includes(currentFocusedKey)) return;

    const fallback = options.focusFallback ?? 'selected';
    if (fallback === 'none') {
      setFocusedKey(undefined);
      return;
    }

    const currentSelectedKey = untrack(selectedKey);
    if (fallback === 'selected' && currentSelectedKey) {
      if (allKeys.includes(currentSelectedKey)) {
        setFocusedKey(currentSelectedKey);
        return;
      }
    }

    if (fallback === 'first' || fallback === 'selected') {
      setFocusedKey(allKeys[0]);
      return;
    }

    setFocusedKey(undefined);
  });

  return {
    focusedKey,
    selectedKey,
    focusedItem,
    selectedItem,
    setFocusedKey: setFocus,
    selectKey,
    selectItem,
    activateKey,
    activateFocused,
    moveFocus,
    focusFirst,
    focusLast,
    onKeyDown,
    isFocused: (item: T) => focusedKey() === options.getKey(item),
    isSelected: (item: T) => selectedKey() === options.getKey(item),
    rowProps: (item: T) => {
      const key = options.getKey(item);
      return {
        highlighted: focusedKey() === key,
        selected: selectedKey() === key,
        onClick: () => selectKey(key),
        onMouseMove: () => setFocus(key, { scroll: false }),
      };
    },
  };
}
