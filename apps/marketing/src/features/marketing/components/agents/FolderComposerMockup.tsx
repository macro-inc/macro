import ArrowsOut from '@phosphor/arrows-out.svg';
import Folder from '@phosphor/folder.svg';
import Upload from '@phosphor/upload-simple.svg';
import X from '@phosphor/x.svg';
import { buttonClasses } from '@ui/components/Button';
import { createSignal, onCleanup, onMount } from 'solid-js';

/** Static presentation copied from FolderComposer / EntityComposer at 5d5bc657.
 * This is the design attachment; its controls are image content, not live inputs. */
export function FolderComposerMockup() {
  let root!: HTMLDivElement;
  const [scale, setScale] = createSignal(1);
  onMount(() => {
    const measure = () => setScale(Math.min(1, root.clientWidth / 600));
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    onCleanup(() => observer.disconnect());
  });
  return (
    <div
      ref={root}
      class="agent-folder-preview"
      style={{ height: `${480 * scale()}px` }}
      role="img"
      aria-label="Client files mockup using Macro’s folder upload composer"
    >
      <div
        class="agent-folder-mockup"
        style={{ transform: `scale(${scale()})` }}
      >
        <div class="portal-scope flex flex-col relative h-full min-h-0 p-4 gap-4">
          <div class="flex items-center gap-1">
            <div class="flex-1 flex items-center">
              <ArrowsOut class="size-5 text-ink-muted" />
            </div>
            <span class={buttonClasses({ size: 'sm', variant: 'outline' })}>
              Clear Draft
            </span>
            <X class="size-5 ml-2 text-ink-muted" />
          </div>
          <div class="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
            <div class="shrink-0 flex gap-2 items-start px-2 text-xl/7 font-medium">
              Client files
            </div>
            <div class="flex min-h-7 items-center gap-2 px-2 text-sm text-ink-muted">
              <span class="size-2 rounded-full bg-pink" />
              Customers<span class="ml-2">+</span>
            </div>
            <div class="mx-2 flex min-h-60 flex-1 flex-col rounded-lg border border-dashed border-edge-muted p-4">
              <div class="flex min-h-44 flex-1 flex-col items-center justify-center gap-3 text-center">
                <Upload class="size-8 text-ink-extra-muted" />
                <div>
                  <p class="text-sm text-ink">
                    Drop files or nested folders here
                  </p>
                  <p class="mt-1 text-xs text-ink-muted">
                    Add everything you want inside this folder.
                  </p>
                </div>
                <div class="flex justify-center gap-2">
                  <span
                    class={buttonClasses({ size: 'sm', variant: 'outline' })}
                  >
                    Add files
                  </span>
                  <span
                    class={buttonClasses({ size: 'sm', variant: 'outline' })}
                  >
                    Add folder
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="shrink-0 flex justify-between items-center gap-2">
            <span class="flex items-center gap-1.5 px-2 text-xs text-ink-muted">
              <Folder class="size-4" />
              Inside My Files
            </span>
            <span
              class={buttonClasses({
                variant: 'strong',
                size: 'md',
                class: 'gap-3',
              })}
            >
              Create Folder <span class="text-xs text-ink-muted">⌘ ↵</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
