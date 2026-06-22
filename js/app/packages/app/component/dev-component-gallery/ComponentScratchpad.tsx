import { ComponentCell } from './ComponentCell';
import { InboxItemScratchLayout } from './items/InboxItemScratchLayout';
import {
  SoupBackedInboxItemActionLocationScratchLayout,
  SoupBackedInboxItemContextBubbleScratchLayout,
  SoupBackedInboxItemNoIconScratchLayout,
  SoupBackedInboxItemScratchLayout,
  SoupBackedInboxItemTypeIconScratchLayout,
} from './items/SoupBackedInboxItemScratchLayout';

export function ComponentScratchpad() {
  return (
    <div class="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto p-4 xl:grid-cols-2">
      <ComponentCell title="Inbox item layout scratch">
        <InboxItemScratchLayout />
      </ComponentCell>
      <ComponentCell title="Soup-backed inbox item scratch">
        <SoupBackedInboxItemScratchLayout />
      </ComponentCell>
      <ComponentCell title="Inbox action/location row scratch">
        <SoupBackedInboxItemActionLocationScratchLayout />
      </ComponentCell>
      <ComponentCell title="Inbox context bubble row scratch">
        <SoupBackedInboxItemContextBubbleScratchLayout />
      </ComponentCell>
      <ComponentCell title="Inbox type/action icon row scratch">
        <SoupBackedInboxItemTypeIconScratchLayout />
      </ComponentCell>
      <ComponentCell title="Inbox no-left-icon row scratch">
        <SoupBackedInboxItemNoIconScratchLayout />
      </ComponentCell>
    </div>
  );
}
