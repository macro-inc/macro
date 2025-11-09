import type { ContextValue } from '@corvu/resizable';
import { createSignal } from 'solid-js';

export * from './bigChat';
export * from './rightbar';

export const LAYOUT_CONTEXT_ID = 'layout';

// TODO: deprecate side bar in layout
export const TOP_BAR_HEIGHT = 42;

export const [resizableContext, setResizableContext] =
  createSignal<ContextValue>();

// default to closed right bar
// NOTE: this is no longer persisted to local storage
export const [persistedLayoutSizes, setPersistedLayoutSizes] = createSignal<
  [number, number]
>([1, 0]);
