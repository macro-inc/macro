import { defineDoc } from '@app/features/ui-gallery/types';
import { For } from 'solid-js';
import { Button } from '../Button';
import { createSnapPager, SnapPager } from './SnapPager';

// #region demo:periods
function PeriodDemo() {
  const pager = createSnapPager();
  return (
    <div class="flex w-full max-w-md flex-col gap-2">
      <div class="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => pager.previous()}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" onClick={() => pager.next()}>
          Next
        </Button>
      </div>
      <SnapPager.Root controller={pager}>
        <SnapPager.Viewport
          class="h-36 rounded-md border border-edge-muted"
          aria-label="Sample periods"
        >
          <For each={pager.pages()}>
            {(page) => (
              <SnapPager.Page page={page}>
                <div class="flex h-full items-center justify-center text-ink">
                  Period {page.position()}
                </div>
              </SnapPager.Page>
            )}
          </For>
        </SnapPager.Viewport>
      </SnapPager.Root>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'SnapPager',
  category: 'Layout',
  description: 'Native scroll-snap paging over seven reusable slots.',
  status: 'stable',
  exports: ['SnapPager', 'createSnapPager'],
  import: "import { SnapPager, createSnapPager } from './SnapPager';",
  propTypes: ['SnapPagerOptions', 'SnapPagerController'],
  guidelines: {
    do: ['Render each slot from its live page position.'],
    dont: ['Wait for settlement to update page content.'],
  },
  demos: [
    {
      id: 'periods',
      title: 'Periods',
      description: 'Swipe or use the controls to navigate.',
      render: PeriodDemo,
    },
  ],
});
