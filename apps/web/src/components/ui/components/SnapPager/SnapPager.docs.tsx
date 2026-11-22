import { defineDoc } from '@app/features/ui-gallery/types';
import { For } from 'solid-js';
import { Button } from '../Button';
import { createSnapPager, SnapPager } from './index';

// #region demo:periods
function PeriodDemo() {
  const pager = createSnapPager();
  return (
    <div class="w-full max-w-md">
      <div class="mb-2 flex gap-2">
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
                  Period {pager.position() + page.offset()}
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
  description: 'Native scroll-snap paging over a stable ring of pages.',
  status: 'stable',
  exports: ['SnapPager', 'createSnapPager'],
  import: "import { SnapPager, createSnapPager } from './SnapPager';",
  propTypes: ['SnapPagerOptions', 'SnapPagerController'],
  demos: [
    {
      id: 'periods',
      title: 'Periods',
      description: 'Swipe or use the controls to navigate.',
      render: PeriodDemo,
    },
  ],
});
