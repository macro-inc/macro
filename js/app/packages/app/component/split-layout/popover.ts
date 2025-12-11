// Public API exports for popover split functionality

export type { PopoverSplitData } from './components/PopoverSplitRenderer';
export {
  ContextTestComponent,
  PopoverContextTest,
} from './examples/PopoverContextTest';
// Demo and example components
export { PopoverDemo, PopoverMinimalExample } from './examples/PopoverDemo';
export {
  PopoverSplitUsageExample,
  QuickActionMenu,
} from './examples/PopoverSplitUsage';
export { useSplitPopovers } from './hooks/useSplitPopovers';
export type {
  PopoverSplitHandle,
  PopoverSplitOptions,
  SplitContent,
  SplitManager,
} from './layoutManager';
