import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { createSignal } from 'solid-js';
import { CreateMenuPreview } from '../components/CreateMenuPreview';
import { useCreateMenuBlocks } from '../Launcher';

export default function CreateMenuDemo() {
  const items = useCreateMenuBlocks();
  const [lastChoice, setLastChoice] = createSignal(
    'Preview only — nothing is created.'
  );
  const [detailsLeft, setDetailsLeft] = createSignal(false);
  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Create menu previews" />
      </SplitHeaderLeft>
      <div class="h-full min-h-0 overflow-auto bg-surface px-4 py-10 text-ink sm:px-10">
        <div class="mx-auto flex max-w-[66rem] flex-col gap-14 pb-10">
          <section
            aria-label="Carousel preview"
            class="w-full max-w-[50rem] self-center"
          >
            <h2 class="mb-4 text-sm font-medium text-ink-muted">Carousel</h2>
            <CreateMenuPreview
              layout="carousel"
              items={items()}
              onChoose={(item) => setLastChoice(`Carousel → ${item.label}`)}
            />
          </section>
          <section
            aria-label="Spotlight preview"
            class="w-full max-w-[50rem] self-center"
          >
            <div class="mb-4 flex items-center justify-between gap-3">
              <h2 class="text-sm font-medium text-ink-muted">Spotlight</h2>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-hover"
                onClick={() => setDetailsLeft((left) => !left)}
              >
                Details on the {detailsLeft() ? 'left' : 'right'} · Flip
              </button>
            </div>
            <CreateMenuPreview
              layout="details"
              detailsLeft={detailsLeft()}
              items={items()}
              onChoose={(item) => setLastChoice(`Spotlight → ${item.label}`)}
            />
          </section>
          <section
            aria-label="Classic list preview"
            class="w-full max-w-[50rem] self-center"
          >
            <h2 class="mb-4 text-sm font-medium text-ink-muted">
              Classic list
            </h2>
            <CreateMenuPreview
              layout="list"
              items={items()}
              onChoose={(item) => setLastChoice(`Classic list → ${item.label}`)}
            />
          </section>
          <p
            role="status"
            aria-live="polite"
            class="text-center text-xs text-ink-extra-muted"
          >
            {lastChoice()}
          </p>
        </div>
      </div>
    </>
  );
}
