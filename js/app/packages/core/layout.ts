import { type Accessor, createSignal } from 'solid-js';
import type { BlockName } from './block';

type SplitContent = {
  type: BlockName | 'component';
  id: string;
  params?: Record<string, string>;
};

type History<T extends object> = {
  items: T[];
  currentIndex: number;
  push: (item: T) => void;
  back: () => T | null;
  forward: () => T | null;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
};

function createHistory<T extends object>(): History<T> {
  let items: T[] = [];
  let currentIndex: number = 0;

  const canGoBack = () => {
    return currentIndex > 0;
  };

  const canGoForward = () => {
    return currentIndex < items.length - 1;
  };

  const isAtEnd = () => {
    return currentIndex === items.length - 1;
  };

  const push = (item: T) => {
    if (!isAtEnd()) {
      items = items.splice(currentIndex);
    }
    items.push(item);
    currentIndex = currentIndex + 1;
  };

  const back = () => {
    if (!canGoBack()) return null;
    currentIndex = currentIndex - 1;
    return items[currentIndex];
  };

  const forward = () => {
    if (!canGoForward()) return null;
    currentIndex = currentIndex + 1;
    return items[currentIndex];
  };

  return {
    items,
    currentIndex,
    back,
    push,
    forward,
    canGoBack,
    canGoForward,
  };
}

type LayoutSplit = {
  position: number;
  content: SplitContent;
  history: History<SplitContent>;
};

function createLayoutSplit(position: number, initialContent: SplitContent) {
  const history = createHistory<SplitContent>();
  history.push(initialContent);
  return {
    position,
    content: initialContent,
    history,
  };
}

export type SplitLayout = {
  splits: Accessor<LayoutSplit[]>;
  createSplit: (initialContent: SplitContent) => void;
  closeSplit: (position: number) => void;
};

export function createSplitLayout(splits: LayoutSplit[]) {
  const [splitsState, setSplits] = createSignal(splits);

  const createSplit = (initialContent: SplitContent) => {
    const newSplit = createLayoutSplit(splitsState().length, initialContent);

    setSplits([...splitsState(), newSplit]);
  };

  const closeSplit = (position: number) => {
    setSplits(splitsState().filter((split) => split.position !== position));
  };

  return {
    splits: splitsState,
    createSplit,
    closeSplit,
  };
}
