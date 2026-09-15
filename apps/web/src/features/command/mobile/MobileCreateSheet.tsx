import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import CloseIcon from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { createUniqueId, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CreatableBlock } from '../types';

/** Touch presentation of the launcher; creation and feature gates belong to the host. */
export function MobileCreateSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CreatableBlock[];
  onSelect: (item: CreatableBlock) => void;
}) {
  const titleId = createUniqueId();
  return (
    <MobileDrawer open={props.open} onOpenChange={props.onOpenChange}>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-labelledby={titleId} class="overflow-hidden">
          <MobileDrawer.Handle class="pb-1" />
          <header class="flex shrink-0 items-center justify-between gap-3 px-6 pb-5">
            <h2 id={titleId} class="text-lg font-semibold text-ink">
              Create new
            </h2>
            <MobileDrawer.Close
              as={Button}
              variant="ghost"
              size="icon-lg"
              aria-label="Close create menu"
              class="rounded-full bg-ink/6"
            >
              <CloseIcon class="size-5" />
            </MobileDrawer.Close>
          </header>
          <MobileDrawer.ScrollBody>
            <MobileDrawer.Section>
              <For each={props.items}>
                {(item) => (
                  <MobileDrawer.Item
                    class="min-h-14 gap-4 px-4 py-3"
                    onClick={() => props.onSelect(item)}
                  >
                    <span class="size-5 shrink-0 text-ink-muted">
                      <Dynamic component={item.icon} />
                    </span>
                    <span class="min-w-0 flex-1 text-base font-medium">
                      {item.label}
                      <Show when={item.launcherHint}>
                        <span class="mt-0.5 block text-sm font-normal leading-5 text-ink-muted">
                          {item.launcherHint}
                        </span>
                      </Show>
                    </span>
                  </MobileDrawer.Item>
                )}
              </For>
            </MobileDrawer.Section>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
