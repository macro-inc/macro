import { createSectionReorder } from '@app/components/view-shell/primitives/create-section-reorder';
import { useUserId } from '@core/context/user';
import { type Accessor, createMemo } from 'solid-js';
import type { ChannelSectionKey } from '../../../types';
import { useChannelsRail } from '../ChannelsRailContext';

/** Chat retains its own preference storage and hidden-section slots. */
export function useSectionReorder(
  keys: Accessor<readonly ChannelSectionKey[]>,
  animate: (reorder: () => void) => void
) {
  const rail = useChannelsRail();
  const userId = useUserId();
  const account = createMemo(() => ({ id: userId() }));
  return createSectionReorder({
    keys,
    account,
    scope: `${rail.railId}:sections`,
    order: rail.sectionOrder,
    setOrder: rail.setSectionOrder,
    animate,
  });
}
