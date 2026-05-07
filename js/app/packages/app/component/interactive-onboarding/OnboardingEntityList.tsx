import type { SoupState } from '@app/component/next-soup/create-soup-state';
import type { EntityData } from '@entity';
import { Entity } from '@entity/entity';
import { cn } from '@ui';
import { createEffect, For, Show } from 'solid-js';

interface OnboardingEntityListProps {
  soup: SoupState;
  removingIds?: () => Set<string>;
}

export function OnboardingEntityList(props: OnboardingEntityListProps) {
  return (
    <>
      <style>{`
        @keyframes onboarding-entity-remove {
          0%   { opacity: 1; transform: translateX(0);     max-height: 48px; }
          60%  { opacity: 0; transform: translateX(-12px); max-height: 48px; }
          100% { opacity: 0; transform: translateX(-12px); max-height: 0; padding-top: 0; padding-bottom: 0; }
        }
        .onboarding-entity-removing {
          overflow: hidden;
          pointer-events: none;
          animation: onboarding-entity-remove 180ms ease-in forwards;
        }
      `}</style>
      <div
        class="flex flex-col size-full scrollbar-hidden overflow-scroll"
        role="listbox"
      >
        <For each={props.soup.rows()}>
          {(row) => {
            const entity = () => row.original;
            const isFocused = () => props.soup.focus.id() === row.id;
            const isRemoving = () => props.removingIds?.().has(row.id) ?? false;
            let rowRef: HTMLDivElement | undefined;

            createEffect(() => {
              if (isFocused()) {
                rowRef?.scrollIntoView({ block: 'nearest' });
              }
            });

            return (
              <Entity.Root
                ref={rowRef}
                entity={entity() as EntityData}
                class={cn(
                  'relative w-full min-h-10 flex items-center gap-2 px-5 text-sm font-semibold',
                  {
                    'bg-accent/5 outline-1 outline-accent/20 -outline-offset-1':
                      isFocused(),
                    'hover:bg-hover/30': !isFocused(),
                    'onboarding-entity-removing': isRemoving(),
                  }
                )}
              >
                <div
                  class={cn(
                    'absolute h-full w-0.75 left-0 top-0 bg-accent opacity-0',
                    { 'opacity-100': isFocused() }
                  )}
                />
                <Show
                  when={entity().type === 'email'}
                  fallback={
                    <>
                      <span class="size-1.5 shrink-0" />
                      <div class="size-4 shrink-0">
                        <Entity.Icon entity={entity() as EntityData} />
                      </div>
                      <Entity.Title entity={entity() as EntityData} />
                      <span class="ml-auto font-mono font-light uppercase tracking-wide text-xs text-ink/40 shrink-0">
                        <Entity.Timestamp entity={entity() as EntityData} />
                      </span>
                    </>
                  }
                >
                  {/* Fixed-width: unread dot + icon + sender */}
                  <div class="w-[22ch] shrink-0 flex items-center gap-2 min-w-0">
                    <span
                      class={cn('size-1.5 rounded-full bg-accent shrink-0', {
                        'opacity-0': (
                          entity() as EntityData & { isRead: boolean }
                        ).isRead,
                      })}
                    />
                    <div class="size-4 shrink-0">
                      <Entity.Icon entity={entity() as EntityData} />
                    </div>
                    <span
                      class={cn('truncate', {
                        'text-ink font-semibold': !(
                          entity() as EntityData & { isRead: boolean }
                        ).isRead,
                        'text-ink/60 font-normal': (
                          entity() as EntityData & { isRead: boolean }
                        ).isRead,
                      })}
                    >
                      {
                        (entity() as EntityData & { senderName: string })
                          .senderName
                      }
                    </span>
                  </div>
                  <span class="flex-1 flex items-baseline gap-2 min-w-0 truncate">
                    <span
                      class={cn('truncate shrink-0 max-w-[40%]', {
                        'font-semibold': !(
                          entity() as EntityData & { isRead: boolean }
                        ).isRead,
                        'font-normal text-ink/70': (
                          entity() as EntityData & { isRead: boolean }
                        ).isRead,
                      })}
                    >
                      <Entity.Title entity={entity() as EntityData} />
                    </span>
                    <span class="truncate text-ink/50 font-normal">
                      {(entity() as EntityData & { snippet: string }).snippet}
                    </span>
                  </span>
                  <span class="ml-auto font-mono font-light uppercase tracking-wide text-xs text-ink/40 shrink-0">
                    <Entity.Timestamp entity={entity() as EntityData} />
                  </span>
                </Show>
              </Entity.Root>
            );
          }}
        </For>
      </div>
    </>
  );
}
