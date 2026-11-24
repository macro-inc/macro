import { createRenderQueue } from '@app/lib/utils/create-render-queue';
import type { SnapPagerController } from '@ui/components/SnapPager/SnapPager';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';

/** Paint the current page first, then fill the rolling ring without waiting on data. */
export function createCalendarPageMounts(
  pager: Pick<SnapPagerController, 'activePage' | 'pages' | 'phase'>
) {
  const queue = createRenderQueue();
  const [mounted, setMounted] = createSignal<readonly number[]>([
    pager.activePage(),
  ]);
  createEffect(
    on(
      () => [pager.phase(), pager.activePage()] as const,
      ([phase]) => {
        queue.clear();
        if (phase !== 'idle') return;
        const frame = requestAnimationFrame(() => {
          const neighbors = [...pager.pages()].sort(
            (a, b) => Math.abs(a.offset()) - Math.abs(b.offset())
          );
          for (const page of neighbors) {
            if (mounted().includes(page.key)) continue;
            queue.enqueue(String(page.key), () => {
              if (pager.phase() !== 'idle') return;
              setMounted((current) =>
                current.includes(page.key) ? current : [...current, page.key]
              );
            });
          }
        });
        onCleanup(() => {
          cancelAnimationFrame(frame);
          queue.clear();
        });
      }
    )
  );
  return mounted;
}
