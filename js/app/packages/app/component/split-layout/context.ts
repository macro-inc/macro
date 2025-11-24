import type { NullableSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createContext,
  type Setter,
  type Signal,
} from 'solid-js';
import type { UnifiedListContext } from '../SoupContext';
import type { SplitHandle, SplitManager } from './layoutManager';

export const SplitLayoutContext = createContext<{
  manager: SplitManager;
}>();

export type HalfSplitState = {
  percentage: number;
  side: 'left' | 'right';
};

export type SplitPanelContextType = {
  handle: SplitHandle;
  splitHotkeyScope: string;
  unifiedListContext: UnifiedListContext;
  isPanelActive: Accessor<boolean>;
  panelRef: Accessor<HTMLElement | null>;
  panelSize: NullableSize;
  contentOffsetTop: Accessor<number>;
  setContentOffsetTop: Setter<number>;
  halfSplitState?: Accessor<HalfSplitState | undefined>;
  previewState: Signal<boolean>;
  layoutRefs: {
    headerLeft?: HTMLDivElement;
    headerRight?: HTMLDivElement;
    toolbarLeft?: HTMLDivElement;
    toolbarRight?: HTMLDivElement;
  };
};

export const SplitPanelContext = createContext<SplitPanelContextType>();
