import SquaresFourIcon from '@phosphor-icons/core/regular/squares-four.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Button, Layer } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ComponentScratchpad } from './ComponentScratchpad';

export function PopupComponentGallery() {
  const [open, setOpen] = createSignal(false);
  const [opacity, setOpacity] = createSignal(100);
  const [depth, setDepth] = createSignal<0 | 1 | 2 | 3 | 4 | 5>(0);

  return (
    <>
      <Button
        aria-label="Toggle component gallery"
        class="fixed right-4 bottom-4 z-modal bg-surface shadow-lg"
        depth={4}
        size="icon-sm"
        variant="base"
        onClick={() => setOpen((value) => !value)}
      >
        <SquaresFourIcon />
      </Button>

      <Show when={open()}>
        <div class="fixed inset-0 z-modal flex items-center justify-center bg-black/30 p-4">
          <Layer depth={depth()}>
            <div
              class="flex h-[90vh] w-[90vw] min-w-0 flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-2xl"
              style={{ opacity: `${opacity() / 100}` }}
            >
              <header class="flex shrink-0 items-center justify-between gap-4 border-b border-edge-muted px-4 py-3">
                <div class="flex min-w-0 items-center gap-4">
                  <label class="flex flex-col gap-1 text-xs text-ink-muted">
                    Opacity
                    <input
                      class="w-28 accent-accent"
                      max="100"
                      min="20"
                      type="range"
                      value={opacity()}
                      onInput={(event) =>
                        setOpacity(Number(event.currentTarget.value))
                      }
                    />
                  </label>
                  <label class="flex flex-col gap-1 text-xs text-ink-muted">
                    Depth
                    <input
                      class="w-28 accent-accent"
                      max="5"
                      min="0"
                      step="1"
                      type="range"
                      value={depth()}
                      onInput={(event) =>
                        setDepth(
                          Number(event.currentTarget.value) as
                            | 0
                            | 1
                            | 2
                            | 3
                            | 4
                            | 5
                        )
                      }
                    />
                  </label>
                </div>
                <Button
                  aria-label="Close component gallery"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                >
                  <XIcon />
                </Button>
              </header>
              <ComponentScratchpad />
            </div>
          </Layer>
        </div>
      </Show>
    </>
  );
}
