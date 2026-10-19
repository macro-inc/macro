import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import CaretDown from '@phosphor/caret-down.svg';
import CaretLeft from '@phosphor/caret-left.svg';
import Check from '@phosphor/check.svg';
import Plus from '@phosphor/plus.svg';
import User from '@phosphor/user.svg';
import Users from '@phosphor/users.svg';
import { Button } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import type { BookingLinksState } from '../booking-links-search';
import type { SchedulingScope } from '../core/types';

export function SchedulingMobileHeader(props: {
  tabs: readonly {
    value: BookingLinksState['tab'];
    label: string;
    icon: Component<{ class?: string }>;
  }[];
  tab: BookingLinksState['tab'];
  scopes: SchedulingScope[];
  ownerId?: string;
  disabled: boolean;
  editorTitle?: string;
  createLabel?: string;
  createAgentAction?: JSX.Element;
  createDisabled: boolean;
  onTab: (tab: BookingLinksState['tab']) => void;
  onOwner: (id: string) => void;
  onBack: () => void;
  onCreate: (opener: HTMLElement) => void;
}) {
  const panel = useSplitPanel();
  const [ownerTrigger, setOwnerTrigger] = createSignal<HTMLButtonElement>();
  const tab = () => props.tabs.find((item) => item.value === props.tab);
  const owner = () => props.scopes.find((scope) => scope.id === props.ownerId);
  const ownerName = () => (owner()?.teamId ? owner()?.name : 'Personal');
  const navigation = () => (
    <div class="h-10 min-w-0 flex-1">
      <h1 class="sr-only">{props.editorTitle ?? tab()?.label}</h1>
      <Show when={props.editorTitle}>
        <div class="flex h-10 min-w-0 items-center gap-2">
          <HeaderIsland class="gap-0 px-1">
            <Button
              square
              size="sm"
              class="p-1 touch:active:bg-transparent"
              label="Back to availability"
              disabled={props.disabled}
              onClick={props.onBack}
            >
              <CaretLeft />
            </Button>
          </HeaderIsland>
          <HeaderIsland>
            <span class="truncate text-sm font-medium">
              {props.editorTitle}
            </span>
          </HeaderIsland>
        </div>
      </Show>
      <fieldset
        aria-label="Scheduling views"
        disabled={props.disabled}
        class="h-10 min-w-0 border-0 p-0 disabled:opacity-50"
        style={{ display: props.editorTitle ? 'none' : undefined }}
      >
        <PillTabs
          scrollable
          class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
          contentClass="px-(--mobile-chrome-gutter)"
          items={props.tabs.map((item) => ({
            value: item.value,
            label: item.label,
          }))}
          value={props.tab}
          onChange={(value) => {
            if (!props.disabled) props.onTab(value);
          }}
          leading={
            <HeaderIsland class="gap-0 px-1">
              <MobileDrawer
                side="bottom"
                restoreFocus
                finalFocusEl={ownerTrigger()}
              >
                <MobileDrawer.Trigger
                  ref={setOwnerTrigger}
                  as={Button}
                  variant="ghost"
                  size="sm"
                  class="h-10 min-w-0 rounded-full px-2"
                  label={`Calendar owner: ${ownerName()}`}
                  disabled={props.disabled}
                >
                  <Show
                    when={owner()?.teamId}
                    fallback={<User class="size-4 shrink-0" />}
                  >
                    <Users class="size-4 shrink-0" />
                  </Show>
                  <span class="max-w-28 truncate">{ownerName()}</span>
                  <CaretDown class="size-3.5 shrink-0" />
                </MobileDrawer.Trigger>
                <MobileDrawer.Portal>
                  <MobileDrawer.Overlay />
                  <MobileDrawer.Content aria-label="Calendar owner">
                    <MobileDrawer.Handle />
                    <MobileDrawer.Title class="px-6 pb-3 text-base font-semibold">
                      Calendar owner
                    </MobileDrawer.Title>
                    <MobileDrawer.ScrollBody>
                      <div class="mx-3 flex flex-col gap-1">
                        <For each={props.scopes}>
                          {(scope) => (
                            <MobileDrawer.Close
                              as={MobileDrawer.Item}
                              aria-label={
                                scope.teamId ? scope.name : 'Personal'
                              }
                              aria-pressed={props.ownerId === scope.id}
                              disabled={props.disabled}
                              onClick={() => props.onOwner(scope.id)}
                            >
                              <Show
                                when={scope.teamId}
                                fallback={<User class="size-4 shrink-0" />}
                              >
                                <Users class="size-4 shrink-0" />
                              </Show>
                              <span class="min-w-0 flex-1 break-words">
                                {scope.teamId ? scope.name : 'Personal'}
                              </span>
                              <Show when={props.ownerId === scope.id}>
                                <Check class="size-4 text-accent" />
                              </Show>
                            </MobileDrawer.Close>
                          )}
                        </For>
                      </div>
                    </MobileDrawer.ScrollBody>
                  </MobileDrawer.Content>
                </MobileDrawer.Portal>
              </MobileDrawer>
              <Show when={props.createLabel}>
                <Button
                  variant="ghost"
                  size="icon-md"
                  class="size-10 rounded-full"
                  label={props.createLabel}
                  disabled={props.createDisabled}
                  onClick={(event) => props.onCreate(event.currentTarget)}
                >
                  <Plus class="size-5" />
                </Button>
              </Show>
              {props.createAgentAction}
            </HeaderIsland>
          }
        />
      </fieldset>
    </div>
  );
  return (
    <Show
      when={panel}
      fallback={
        <header
          aria-label="Scheduling controls"
          class="@container/split-header pointer-events-none absolute inset-x-0 top-[calc(var(--safe-top,0px)+0.5rem)] z-split-panel-chrome flex h-10 min-w-0 items-center gap-2 px-(--mobile-chrome-gutter)"
        >
          {navigation()}
        </header>
      }
    >
      <SplitHeaderLeft>{navigation()}</SplitHeaderLeft>
    </Show>
  );
}
