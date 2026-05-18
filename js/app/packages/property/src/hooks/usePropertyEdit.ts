import { useProperty } from '../core/context';

/**
 * Convenience hook around <Property.Root>'s edit affordance.
 * - `open(anchor?)`: invokes the root's onEdit handler.
 * - `isReadOnly()`: combines canEdit + isMetadata.
 */
export function usePropertyEdit() {
  const ctx = useProperty();
  return {
    open(anchor?: HTMLElement) {
      const p = ctx.property();
      if (!ctx.canEdit() || p.isMetadata) return;
      ctx.onEdit?.(p, anchor);
    },
    isReadOnly: () => !ctx.canEdit() || ctx.property().isMetadata,
  };
}
