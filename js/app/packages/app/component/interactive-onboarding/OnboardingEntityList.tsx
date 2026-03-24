import { Entity } from '@entity/entity';
import type { EntityData } from '@entity';
import type { SoupState } from '@app/component/next-soup/create-soup-state';
import { createEffect, For } from 'solid-js';
import { cn } from '@ui/utils/classname';

interface OnboardingEntityListProps {
  soup: SoupState;
}

export function OnboardingEntityList(props: OnboardingEntityListProps) {
  return (
    <div
      class="flex flex-col w-full h-full scrollbar-hidden overflow-scroll"
      role="listbox"
    >
      <For each={props.soup.data()}>
        {(entity) => {
          const isFocused = () => props.soup.focus.id() === entity.id;
          let rowRef: HTMLDivElement | undefined;

          createEffect(() => {
            if (isFocused()) {
              rowRef?.scrollIntoView({ block: 'nearest' });
            }
          });

          return (
            <Entity.Root
              ref={rowRef}
              entity={entity as EntityData}
              class={cn(
                'relative w-full min-h-10 flex items-center gap-2 px-3 text-sm font-semibold',
                {
                  'bg-accent/5 outline-1 outline-accent/20 outline-offset-[-1px]':
                    isFocused(),
                  'hover:bg-hover/30': !isFocused(),
                }
              )}
            >
              <div
                class={cn(
                  'absolute h-full w-[3px] left-0 top-0 bg-accent opacity-0',
                  { 'opacity-100': isFocused() }
                )}
              />
              <div class="size-4 shrink-0">
                <Entity.Icon entity={entity as EntityData} />
              </div>
              <Entity.Title entity={entity as EntityData} />
            </Entity.Root>
          );
        }}
      </For>
    </div>
  );
}
