import { createSignal } from 'solid-js';

export type History<T extends object> = {
  readonly items: ReadonlyArray<T>;
  readonly index: Readonly<number>;
  back: () => T | null;
  forward: () => T | null;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  push: (next: T) => void;
  merge: (next: T) => void;
  remove: (
    test: (item: T) => boolean,
    options?: { deleteAll?: boolean }
  ) => T | null;
};

const inc = (x: number) => x + 1;
const dec = (x: number) => x - 1;

export function createHistory<T extends object>(): History<T> {
  let items: T[] = [];
  const [index, setIndex] = createSignal(-1);

  const canGoBack = () => {
    return index() > 0;
  };

  const canGoForward = () => {
    return index() < items.length - 1;
  };

  const isAtEnd = () => {
    if (items.length === 0) return true;
    return index() === items.length - 1;
  };

  const push = (next: T) => {
    if (!isAtEnd()) {
      fork(next);
      return;
    }
    items.push(next);
    setIndex(inc);
  };

  const merge = (next: T) => {
    items.splice(index(), items.length - index());
    items.push(next);
  };

  const fork = (next: T) => {
    items.splice(index() + 1, items.length - index() - 1);
    items.push(next);
    setIndex(inc);
  };

  const back = () => {
    if (!canGoBack()) return null;
    setIndex(dec);
    return items[index()];
  };

  const forward = () => {
    if (!canGoForward()) return null;
    setIndex(inc);
    return items[index()];
  };

  const remove = (test: (item: T) => boolean) => {
    const prevItems = items;
    const prevIndex = index();

    let newIndex = prevIndex;
    const nextItems: T[] = [];

    for (let i = 0; i < prevItems.length; i++) {
      const item = prevItems[i];
      if (test(item)) {
        if (i < prevIndex) {
          newIndex -= 1;
        }
        continue;
      }
      nextItems.push(item);
    }

    if (nextItems.length === 0) {
      items = [];
      setIndex(-1);
      return;
    }

    if (newIndex >= nextItems.length) {
      newIndex = nextItems.length - 1;
    }

    items = nextItems;
    console.log('NEXT ITEMS');
    setIndex(newIndex);
    return items[newIndex] ?? null;
  };
  return {
    get items() {
      return items;
    },
    get index() {
      return index();
    },
    back,
    push,
    merge,
    forward,
    canGoBack,
    canGoForward,
    remove,
  };
}
