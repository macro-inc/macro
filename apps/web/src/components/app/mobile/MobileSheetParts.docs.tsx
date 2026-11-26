import { defineDoc } from '@app/features/ui-gallery/types';
import ClockIcon from '@icon/system/regular/clock.svg';
import { Button } from '@ui';
import { createSignal, For } from 'solid-js';
import { MobileDrawer } from './MobileDrawer';
import { SheetFooter } from './SheetFooter';
import { SheetGroup } from './SheetGroup';
import { SheetRow } from './SheetRow';

// #region demo:sheet
function MobileSheetPartsDemo() {
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  return (
    <div class="mobile-sheet flex h-[420px] w-[374px] max-w-full flex-col overflow-hidden bg-menu text-ink">
      <MobileDrawer.Handle />
      <div
        ref={setScroller}
        class="min-h-0 flex-auto overflow-y-auto px-5 pb-1"
      >
        <div class="flex flex-col gap-4">
          <For each={['When', 'People', 'Call', 'Reminders', 'Visibility']}>
            {(label) => (
              <SheetGroup aria-label={label}>
                <SheetRow icon={<ClockIcon class="size-4" />}>
                  <div class="py-6">{label}</div>
                </SheetRow>
              </SheetGroup>
            )}
          </For>
        </div>
      </div>
      <SheetFooter scrollElement={scroller}>
        <Button variant="primary" size="sheet" fullWidth>
          Create event
        </Button>
      </SheetFooter>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Mobile sheet parts',
  category: 'Layout',
  description:
    'Composable sheet groups, icon-aligned rows, and pinned footer fade.',
  propTypes: ['SheetGroupProps', 'SheetRowProps', 'SheetFooterProps'],
  guidelines: {
    do: ['Keep one scroller and the footer outside it.'],
    dont: ['Put a second scroll container inside a field group.'],
  },
  demos: [
    {
      id: 'sheet',
      title: 'Scroll to the end to clear the footer fade',
      render: MobileSheetPartsDemo,
    },
  ],
});
