import '../../../index.css';
import { createSnapPager, SnapPager } from '@ui/components/SnapPager';
import { For } from 'solid-js';
import { render } from 'solid-js/web';

function Fixture() {
  const pager = createSnapPager();
  return (
    <main class="p-4 bg-page text-ink">
      <output aria-label="Position">{pager.position()}</output>
      <button onClick={() => pager.next()}>Next</button>
      <button onClick={() => pager.setLocked(!pager.locked())}>
        Toggle lock
      </button>
      <SnapPager.Root controller={pager}>
        <SnapPager.Viewport
          aria-label="Native periods"
          class="h-96 w-[min(400px,90vw)]"
        >
          <For each={pager.pages()}>
            {(page) => (
              <SnapPager.Page page={page}>
                <div class="h-full overflow-y-auto">
                  <div class="h-[1000px]">
                    Period {pager.position() + page.offset()}
                  </div>
                </div>
              </SnapPager.Page>
            )}
          </For>
        </SnapPager.Viewport>
      </SnapPager.Root>
    </main>
  );
}
const root = document.getElementById('root');
if (root) render(Fixture, root);
