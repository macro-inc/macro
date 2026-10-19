import { SearchBar } from '@app/components/view-shell';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  ContextMenuContent,
  ContextMenuTrigger,
  MENU_ITEM_CLASS,
  MenuGroup,
} from '@core/component/ContextMenu';
import { touchHandler } from '@core/directive/touchHandler';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ContextMenu } from '@kobalte/core/context-menu';
import External from '@phosphor/arrow-square-out.svg';
import ArrowsClockwise from '@phosphor/arrows-clockwise.svg';
import Copy from '@phosphor/copy.svg';
import Dots from '@phosphor/dots-three.svg';
import Globe from '@phosphor/globe-simple.svg';
import Link from '@phosphor/link.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import Timer from '@phosphor/timer.svg';
import Trash from '@phosphor/trash.svg';
import User from '@phosphor/user.svg';
import Users from '@phosphor/users.svg';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { Badge, Button, cn, Dropdown, ToggleSwitch } from '@ui';
import { batch, createSignal, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { EventType, SchedulingScope } from '../core/types';
import { SchedulingDrawerHeader } from './scheduling-drawer-header';

export function EventTypesPanel(props: {
  events: EventType[];
  owner?: SchedulingScope;
  search?: string;
  canEdit: boolean;
  saving: boolean;
  onView: (event: EventType, opener?: HTMLElement) => void;
  onEdit: (event: EventType, opener?: HTMLElement) => void;
  onToggle: (event: EventType, enabled: boolean) => void;
  onDuplicate: (event: EventType, opener?: HTMLElement) => void;
  onDelete: (event: EventType) => void;
  onCopy: (event: EventType) => void;
  link: (event: EventType) => string;
}) {
  const [localSearch, setSearch] = createSignal('');
  const search = () => (props.search ?? localSearch()).trim();
  const [removing, setRemoving] = createSignal<string>();
  const [drawerSelection, setDrawerSelection] = createSignal<{
    id: string;
    opener?: HTMLElement;
  }>();
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  let drawerAction: (() => void) | undefined;
  const drawerEvent = () =>
    props.events.find((event) => event.id === drawerSelection()?.id);
  const openDrawer = (event: EventType, opener?: HTMLElement) => {
    if (props.saving) return;
    drawerAction = undefined;
    batch(() => {
      setDrawerSelection({ id: event.id, opener });
      setDrawerOpen(true);
    });
  };
  const finishDrawerClose = (present: boolean) => {
    if (present || drawerOpen()) return;
    // Let Corvu finish its presence update before disposing the drawer.
    queueMicrotask(() => {
      if (drawerOpen()) return;
      const opener = drawerSelection()?.opener;
      const action = drawerAction;
      drawerAction = undefined;
      setDrawerSelection(undefined);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      if (action) queueMicrotask(action);
    });
  };
  const filtered = () =>
    props.events.filter((e) =>
      `${e.title} ${e.description} ${e.slug} ${props.owner?.name ?? ''} ${props.owner?.teamId ? 'team' : 'personal'}`
        .toLowerCase()
        .includes(search().toLowerCase())
    );
  function MenuItems(menu: {
    event: EventType;
    opener?: HTMLElement;
    context?: boolean;
    drawer?: boolean;
    onClose?: () => void;
    onEditorAction?: (action: () => void) => void;
  }) {
    const MenuItem = menu.context ? ContextMenu.Item : Dropdown.Item;
    const Group = menu.drawer
      ? MobileDrawer.Section
      : menu.context
        ? MenuGroup
        : Dropdown.Group;
    const Item = (item: {
      children: JSX.Element;
      onSelect: () => void;
      disabled?: boolean;
      class?: string;
    }) => (
      <Show when={menu.drawer} fallback={<MenuItem {...item} />}>
        <MobileDrawer.Item
          disabled={item.disabled}
          class={item.class}
          onClick={() => {
            item.onSelect();
            menu.onClose?.();
          }}
        >
          {item.children}
        </MobileDrawer.Item>
      </Show>
    );
    return (
      <>
        <Group>
          <Item
            class={menu.context ? MENU_ITEM_CLASS : undefined}
            disabled={!menu.event.enabled}
            onSelect={() => props.onCopy(menu.event)}
          >
            <Copy class="size-4" />
            Copy link
          </Item>
          <Item
            class={menu.context ? MENU_ITEM_CLASS : undefined}
            onSelect={() => {
              window.open(
                props.link(menu.event),
                '_blank',
                'noopener,noreferrer'
              );
            }}
          >
            <External class="size-4" />
            Preview
          </Item>
        </Group>
        <Show when={props.canEdit}>
          <Group>
            <Item
              class={menu.context ? MENU_ITEM_CLASS : undefined}
              disabled={props.saving}
              onSelect={() => {
                const edit = () => props.onEdit(menu.event, menu.opener);
                if (menu.onEditorAction) menu.onEditorAction(edit);
                else edit();
              }}
            >
              <Pencil class="size-4" />
              Edit
            </Item>
            <Item
              class={menu.context ? MENU_ITEM_CLASS : undefined}
              disabled={props.saving}
              onSelect={() => {
                const duplicate = () =>
                  props.onDuplicate(menu.event, menu.opener);
                if (menu.onEditorAction) menu.onEditorAction(duplicate);
                else duplicate();
              }}
            >
              <Copy class="size-4" />
              Duplicate
            </Item>
          </Group>
          <Group>
            <Item
              class={cn(menu.context && MENU_ITEM_CLASS, 'text-failure')}
              disabled={props.saving}
              onSelect={() => setRemoving(menu.event.id)}
            >
              <Trash class="size-4" />
              Delete
            </Item>
          </Group>
        </Show>
      </>
    );
  }
  return (
    <div class="@container/booking-links flex min-w-0 flex-col gap-1">
      <Show when={props.search === undefined}>
        <SearchBar
          label="Search booking links"
          placeholder="Search booking links…"
          value={localSearch()}
          onValueChange={setSearch}
          class="mb-3 max-w-md"
        />
      </Show>
      <div>
        <For
          each={filtered()}
          fallback={
            <div class="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <Link class="size-7 text-ink-muted" />
              <h2 class="font-semibold">
                {search()
                  ? 'No matching event types'
                  : 'Create your first booking link'}
              </h2>
              <p class="max-w-sm text-sm text-ink-muted">
                {search()
                  ? 'Try a different title or link.'
                  : 'Choose a duration and availability, then share your link.'}
              </p>
            </div>
          }
        >
          {(event) => {
            let rowButton: HTMLButtonElement | undefined;
            let menuAction: (() => void) | undefined;
            const finishMenuClose = (event: Event) => {
              if (!menuAction) return;
              event.preventDefault();
              const action = menuAction;
              menuAction = undefined;
              queueMicrotask(() => {
                rowButton?.focus({ preventScroll: true });
                action();
              });
            };
            return (
              <ContextMenu>
                <ContextMenuTrigger
                  as="article"
                  disabled={props.saving || isTouchDevice()}
                  ref={(element: HTMLElement) => {
                    touchHandler(element, () => ({
                      onLongPress: () => openDrawer(event, rowButton),
                    }));
                  }}
                  onContextMenu={(contextEvent) => {
                    if (!isTouchDevice()) return;
                    contextEvent.preventDefault();
                    contextEvent.stopPropagation();
                    openDrawer(event, rowButton);
                  }}
                  class="min-h-10 min-w-0 rounded-xl px-2 py-1 transition-opacity hover:bg-list-hover focus-within:bg-list-hover"
                  classList={{ 'opacity-50': !event.enabled }}
                >
                  <div class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 not-touch:@min-[36rem]/booking-links:grid-cols-[auto_minmax(0,1fr)_auto]">
                    <ToggleSwitch
                      checked={event.enabled}
                      disabled={!props.canEdit || props.saving}
                      label={
                        <span class="sr-only">
                          Accept bookings for {event.title}
                        </span>
                      }
                      class="shrink-0"
                      size="sm"
                      onChange={(v) => props.onToggle(event, v)}
                    />
                    <button
                      ref={rowButton}
                      type="button"
                      aria-label={event.title}
                      aria-keyshortcuts="Shift+F10"
                      onKeyDown={(keyEvent) => {
                        if (
                          keyEvent.key !== 'ContextMenu' &&
                          !(keyEvent.shiftKey && keyEvent.key === 'F10')
                        )
                          return;
                        keyEvent.preventDefault();
                        keyEvent.stopPropagation();
                        if (props.saving) return;
                        if (isTouchDevice()) {
                          openDrawer(event, keyEvent.currentTarget);
                          return;
                        }
                        const bounds =
                          keyEvent.currentTarget.getBoundingClientRect();
                        keyEvent.currentTarget.dispatchEvent(
                          new MouseEvent('contextmenu', {
                            bubbles: true,
                            cancelable: true,
                            clientX: bounds.left,
                            clientY: bounds.bottom,
                          })
                        );
                      }}
                      onClick={(click) =>
                        props.onView(event, click.currentTarget)
                      }
                      class="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Link
                        aria-hidden="true"
                        class="size-4 shrink-0 text-ink-muted"
                      />
                      <h2 class="min-w-0 max-w-[min(16rem,60%)] shrink-0 truncate text-sm font-medium">
                        {event.title}
                      </h2>
                      <Show when={event.description}>
                        <p class="min-w-0 flex-1 truncate text-sm text-ink-muted">
                          {event.description}
                        </p>
                      </Show>
                    </button>
                    <div class="col-start-2 flex min-w-0 flex-wrap items-center justify-end gap-2 touch:justify-start touch:pl-6 not-touch:@min-[36rem]/booking-links:col-start-auto">
                      <Dropdown>
                        <Dropdown.Trigger
                          as="button"
                          type="button"
                          aria-label={`Link actions for ${event.title}`}
                          class={propertyPillClasses({
                            variant: 'outline',
                            size: 'md',
                            readOnly: true,
                            class: 'min-w-0 max-w-56 shrink',
                          })}
                        >
                          <Globe aria-hidden="true" class="size-3" />
                          <span class="truncate">/{event.slug}</span>
                        </Dropdown.Trigger>
                        <Dropdown.Content class="min-w-40">
                          <Dropdown.Group>
                            <Dropdown.Item
                              disabled={!event.enabled}
                              onSelect={() => props.onCopy(event)}
                            >
                              <Copy class="size-4" />
                              Copy link
                            </Dropdown.Item>
                            <Dropdown.Item
                              onSelect={() => {
                                window.open(
                                  props.link(event),
                                  '_blank',
                                  'noopener,noreferrer'
                                );
                              }}
                            >
                              <External class="size-4" />
                              Open in new tab
                            </Dropdown.Item>
                          </Dropdown.Group>
                        </Dropdown.Content>
                      </Dropdown>
                      <Badge
                        variant="outline"
                        size="md"
                        class={propertyPillClasses({
                          variant: 'outline',
                          size: 'md',
                          readOnly: true,
                        })}
                      >
                        <Timer aria-hidden="true" class="size-3" />
                        {event.durationMinutes}m
                      </Badge>
                      <Badge
                        variant="outline"
                        size="md"
                        class={propertyPillClasses({
                          variant: 'outline',
                          size: 'md',
                          readOnly: true,
                        })}
                      >
                        {match(event.mode)
                          .with('individual', () => (
                            <>
                              <User aria-hidden="true" class="size-3" />
                              Individual
                            </>
                          ))
                          .with('collective', () => (
                            <>
                              <Users aria-hidden="true" class="size-3" />
                              Collective
                            </>
                          ))
                          .with('roundRobin', () => (
                            <>
                              <ArrowsClockwise
                                aria-hidden="true"
                                class="size-3"
                              />
                              Round robin
                            </>
                          ))
                          .exhaustive()}
                      </Badge>
                      <Dropdown>
                        <Dropdown.Trigger
                          variant="ghost"
                          size="icon-sm"
                          label={`Options for ${event.title}`}
                          class="shrink-0 touch:hidden"
                          disabled={props.saving}
                          tooltipDisabled
                        >
                          <Dots class="size-4" />
                        </Dropdown.Trigger>
                        <Dropdown.Content
                          class="min-w-40"
                          onCloseAutoFocus={finishMenuClose}
                        >
                          <MenuItems
                            event={event}
                            opener={rowButton}
                            onEditorAction={(action) => {
                              menuAction = action;
                            }}
                          />
                        </Dropdown.Content>
                      </Dropdown>
                    </div>
                  </div>
                  <Show when={props.canEdit && removing() === event.id}>
                    <div class="mt-4 flex flex-wrap items-center gap-3 border-t border-edge-muted pt-4">
                      <p class="flex-1 text-sm">
                        Delete this event type? Existing bookings are kept.
                      </p>
                      <Button
                        variant="ghost"
                        onClick={() => setRemoving(undefined)}
                      >
                        Keep
                      </Button>
                      <Button
                        variant="outline"
                        disabled={props.saving}
                        onClick={() => props.onDelete(event)}
                      >
                        Delete event type
                      </Button>
                    </div>
                  </Show>
                </ContextMenuTrigger>
                <ContextMenu.Portal>
                  <ContextMenuContent
                    class="min-w-40"
                    onCloseAutoFocus={finishMenuClose}
                  >
                    <MenuItems
                      event={event}
                      opener={rowButton}
                      context
                      onEditorAction={(action) => {
                        menuAction = action;
                      }}
                    />
                  </ContextMenuContent>
                </ContextMenu.Portal>
              </ContextMenu>
            );
          }}
        </For>
      </div>
      <Show when={drawerSelection()}>
        <MobileDrawer
          side="bottom"
          open={drawerOpen()}
          onOpenChange={setDrawerOpen}
          onContentPresentChange={finishDrawerClose}
          closeOnOutsidePointerStrategy="pointerdown"
          preventScroll={false}
          preventScrollbarShift={false}
          restoreFocus={false}
        >
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content aria-label="Booking link actions">
              <MobileDrawer.Handle class="pb-1" />
              <SchedulingDrawerHeader
                title={drawerEvent()?.title ?? 'Booking link'}
                closeLabel="Close booking link actions"
                onClose={() => setDrawerOpen(false)}
              />
              <MobileDrawer.ScrollBody
                data-corvu-no-drag
                class="touch-pan-y overscroll-contain gap-3"
              >
                <Show when={drawerEvent()}>
                  {(event) => (
                    <MenuItems
                      event={event()}
                      opener={drawerSelection()?.opener}
                      drawer
                      onClose={() => setDrawerOpen(false)}
                      onEditorAction={(action) => {
                        drawerAction = action;
                      }}
                    />
                  )}
                </Show>
              </MobileDrawer.ScrollBody>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </div>
  );
}
