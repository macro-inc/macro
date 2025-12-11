import { useContext } from 'solid-js';
import { SplitLayoutContext } from '../context';
import type { PopoverSplitHandle, PopoverSplitOptions } from '../layoutManager';

/**
 * Hook for managing popover splits within a SplitLayout context
 */
export function useSplitPopovers() {
  const context = useContext(SplitLayoutContext);

  if (!context) {
    throw new Error(
      'useSplitPopovers must be used within a SplitLayoutContext'
    );
  }

  const { manager } = context;

  return {
    /**
     * Create a new popover split with the provided options
     */
    createPopover: (options: PopoverSplitOptions): PopoverSplitHandle => {
      return manager.createPopoverSplit(options);
    },

    /**
     * Get all currently active popover splits
     */
    getActivePopovers: (): PopoverSplitHandle[] => {
      return manager.getActivePopovers();
    },

    /**
     * Close all active popover splits
     */
    closeAllPopovers: (): void => {
      manager.closeAllPopovers();
    },

    /**
     * Create a popover with a block
     */
    createBlockPopover: (
      blockType: string,
      blockId: string,
      options?: Partial<PopoverSplitOptions>
    ): PopoverSplitHandle => {
      return manager.createPopoverSplit({
        content: { type: blockType as any, id: blockId },
        ...options,
      });
    },

    /**
     * Create a popover with a registered component
     */
    createComponentPopover: (
      componentId: string,
      params?: Record<string, any>,
      options?: Partial<PopoverSplitOptions>
    ): PopoverSplitHandle => {
      return manager.createPopoverSplit({
        content: { type: 'component', id: componentId, params },
        ...options,
      });
    },
  };
}
