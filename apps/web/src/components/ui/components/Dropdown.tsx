import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { DropdownMenu as KobalteDropdownMenu } from '@kobalte/core/dropdown-menu';
import CheckIcon from '@phosphor/check.svg';
import { type ComponentProps, onCleanup, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import {
  addCtrlJKMenuNavigation,
  highlightFirstMenuItemOnOpen,
} from '../utils/menuKeyboardNavigation';
import { Button, type ButtonProps } from './Button';
import { Surface, type SurfaceProps } from './Surface';

/*
<Dropdown>
  <Dropdown.Trigger>Filter</Dropdown.Trigger>
  <Dropdown.Content>
    <Dropdown.Group>
      <Dropdown.Item></Dropdown.Item>
    </Dropdown.Group>
  </Dropdown.Content>
</Dropdown>
*/

/*
// Kobalte's "grace polygon" keeps an open sub alive when the
// pointer crosses toward its content. For sibling In/From triggers,
// that means moving between them leaves the prior sub stuck open
// and the prior trigger stuck with data-highlighted. Force focus
// + open so Kobalte's parent selection manager updates to this
// trigger and the shared signal closes the sibling.
*/

// const DROPDOWN_CONTENT_CLASS = 'z-action-menu bg-surface rounded-xl ring-1 ring-edge shadow-menu p-1.5';
// const DROPDOWN_ITEM_CLASS = 'rounded-md hover:bg-ink/3 focus:bg-ink/3 data-[highlighted]:bg-ink/3';

type PortalMount = ComponentProps<typeof KobalteDropdownMenu.Portal>['mount'];
type DropdownPortalScope = 'local';

export type DropdownSubContentProps = ComponentProps<
  typeof KobalteDropdownMenu.SubContent
> & {
  depth?: SurfaceProps['depth'];
  mount?: PortalMount;
  portalScope?: DropdownPortalScope;
};
export type DropdownContentProps = ComponentProps<
  typeof KobalteDropdownMenu.Content
> & {
  depth?: SurfaceProps['depth'];
  mount?: PortalMount;
  portalScope?: DropdownPortalScope;
};
export type DropdownTriggerProps = ComponentProps<
  typeof KobalteDropdownMenu.Trigger
> &
  ButtonProps;
export type DropdownItemIndicatorProps = ComponentProps<
  typeof KobalteDropdownMenu.ItemIndicator
>;
export type DropdownCheckboxItemProps = ComponentProps<
  typeof KobalteDropdownMenu.CheckboxItem
>;
export type DropdownSubTriggerProps = ComponentProps<
  typeof KobalteDropdownMenu.SubTrigger
>;
export type DropdownRadioItemProps = ComponentProps<
  typeof KobalteDropdownMenu.RadioItem
>;
export type DropdownGroupLabelProps = ComponentProps<
  typeof KobalteDropdownMenu.GroupLabel
>;
export type DropdownGroupProps = ComponentProps<
  typeof KobalteDropdownMenu.Group
>;
export type DropdownItemProps = ComponentProps<typeof KobalteDropdownMenu.Item>;
export type DropdownSubProps = ComponentProps<typeof KobalteDropdownMenu.Sub>;

const ROW_CLASS =
  'group rounded-lg w-full flex items-center gap-1.5 p-1.5 px-2 text-left font-normal text-sm cursor-default outline-none data-highlighted:bg-ink/5 data-disabled:opacity-50 data-disabled:cursor-not-allowed';

function resolvePortalMount(
  searchRef: HTMLElement | undefined,
  mount: PortalMount,
  portalScope: DropdownPortalScope | undefined
): PortalMount {
  if (mount || portalScope !== 'local') return mount;
  return searchRef?.closest<HTMLElement>('.portal-scope') ?? undefined;
}

function installKeyboardNavigation(el: HTMLElement) {
  const cleanup = addCtrlJKMenuNavigation(el);
  onCleanup(cleanup);
}

// Kobalte's dismissable layer deliberately defers "outside interaction"
// dismissal on touch devices until a `click` event fires, so that a
// scroll/swipe passing over the trigger isn't mistaken for a tap (see
// createInteractOutside in @kobalte/core). A tap outside naturally produces
// that click, so it still closes the menu. But a swipe (e.g. scrolling a
// list behind the dropdown, or a swipe gesture that passes near it) never
// produces a click, so it's left open — anywhere a tap dismisses the menu,
// a swipe should too.
//
// We detect a swipe as touch movement past a small threshold that starts
// outside the menu content, then dispatch a synthetic Escape keydown — the
// same signal Kobalte's DismissableLayer already uses to close the
// top-most open layer — rather than synthesizing a `click`, which could
// wrongly activate whatever element the swipe happened to pass over.
const SWIPE_DISMISS_THRESHOLD_PX = 10;

function installSwipeToDismiss(contentEl: HTMLElement) {
  if (!isTouchDevice()) return;

  let startX = 0;
  let startY = 0;
  let tracking = false;

  function onTouchStart(e: TouchEvent) {
    const touch = e.touches[0];
    const target = e.target as Node | null;
    if (!touch || !target || contentEl.contains(target)) {
      tracking = false;
      return;
    }
    startX = touch.clientX;
    startY = touch.clientY;
    tracking = true;
  }

  function onTouchMove(e: TouchEvent) {
    if (!tracking) return;
    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.hypot(dx, dy) < SWIPE_DISMISS_THRESHOLD_PX) return;

    tracking = false;
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
  }

  function stopTracking() {
    tracking = false;
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: true });
  document.addEventListener('touchend', stopTracking, { passive: true });
  document.addEventListener('touchcancel', stopTracking, { passive: true });

  onCleanup(() => {
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', stopTracking);
    document.removeEventListener('touchcancel', stopTracking);
  });
}

function callRef<T>(ref: ((el: T) => void) | undefined, el: T) {
  ref?.(el);
}

function DropdownContent(props: DropdownContentProps) {
  let searchRef: HTMLDivElement | undefined;
  let contentRef: HTMLElement | undefined;
  const [local, rest] = splitProps(props, [
    'depth',
    'class',
    'mount',
    'portalScope',
    'children',
    'ref',
    'onOpenAutoFocus',
  ]);
  const handleOpenAutoFocus = (event: Event) => {
    local.onOpenAutoFocus?.(event);
    if (!event.defaultPrevented && contentRef) {
      highlightFirstMenuItemOnOpen(contentRef);
    }
  };
  const setContentRef = (el: HTMLElement) => {
    installKeyboardNavigation(el);
    installSwipeToDismiss(el);
    contentRef = el;
    callRef(local.ref, el);
  };

  return (
    <>
      <div class="hidden" ref={searchRef} />
      <KobalteDropdownMenu.Portal
        mount={resolvePortalMount(searchRef, local.mount, local.portalScope)}
      >
        <KobalteDropdownMenu.Content
          class={cn(
            'rounded-xl size-auto z-action-menu menu-open-animation shadow-menu bg-menu',
            local.class
          )}
          depth={local.depth ?? 2}
          as={Surface}
          {...rest}
          onOpenAutoFocus={handleOpenAutoFocus}
          ref={setContentRef}
        >
          <div class="flex flex-col gap-(--app-border-width) bg-edge-muted size-full">
            {local.children}
          </div>
        </KobalteDropdownMenu.Content>
      </KobalteDropdownMenu.Portal>
    </>
  );
}

function DropdownSubContent(props: DropdownSubContentProps) {
  let searchRef: HTMLDivElement | undefined;
  const [local, rest] = splitProps(props, [
    'depth',
    'class',
    'mount',
    'portalScope',
    'children',
    'ref',
  ]);
  const setContentRef = (el: HTMLElement) => {
    installKeyboardNavigation(el);
    installSwipeToDismiss(el);
    callRef(local.ref, el);
  };

  return (
    <>
      <div class="hidden" ref={searchRef} />
      <KobalteDropdownMenu.Portal
        mount={resolvePortalMount(searchRef, local.mount, local.portalScope)}
      >
        <KobalteDropdownMenu.SubContent
          class={cn(
            'rounded-xl size-auto z-action-menu menu-open-animation bg-menu [--color-surface:var(--color-menu)]',
            local.class
          )}
          depth={local.depth ?? 2}
          as={Surface}
          {...rest}
          ref={setContentRef}
        >
          <div class="flex flex-col gap-(--app-border-width) bg-edge-muted size-full">
            {local.children}
          </div>
        </KobalteDropdownMenu.SubContent>
      </KobalteDropdownMenu.Portal>
    </>
  );
}

function DropdownGroup(props: DropdownGroupProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteDropdownMenu.Group
      class={cn('flex flex-col p-1.5 bg-menu', local.class)}
      {...rest}
    />
  );
}

function DropdownGroupLabel(props: DropdownGroupLabelProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteDropdownMenu.GroupLabel
      class={cn(
        'px-2 h-7 flex items-center text-xs text-ink-extra-muted',
        local.class
      )}
      {...rest}
    />
  );
}

const CHECKBOX_ITEM_BOX_CLASS = cn(
  'inline-flex items-center justify-center size-3.5 shrink-0 rounded-sm',
  'border border-transparent text-surface',
  'group-data-highlighted:border-edge-muted',
  'group-data-checked:bg-accent group-data-checked:border-accent'
);

function DropdownCheckboxItem(props: DropdownCheckboxItemProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <KobalteDropdownMenu.CheckboxItem
      class={cn(ROW_CLASS, local.class)}
      {...rest}
    >
      <div class={CHECKBOX_ITEM_BOX_CLASS}>
        <KobalteDropdownMenu.ItemIndicator>
          <CheckIcon class="size-2.5" />
        </KobalteDropdownMenu.ItemIndicator>
      </div>
      {local.children}
    </KobalteDropdownMenu.CheckboxItem>
  );
}

function DropdownItemIndicator(props: DropdownItemIndicatorProps) {
  return <KobalteDropdownMenu.ItemIndicator {...props} />;
}

function DropdownSubTrigger(props: DropdownSubTriggerProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteDropdownMenu.SubTrigger
      class={cn(ROW_CLASS, 'justify-between', local.class)}
      {...rest}
    />
  );
}

function DropdownRadioItem(props: DropdownRadioItemProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteDropdownMenu.RadioItem
      class={cn(ROW_CLASS, local.class)}
      {...rest}
    />
  );
}

function DropdownSub(props: DropdownSubProps) {
  return <KobalteDropdownMenu.Sub gutter={2} shift={-7} {...props} />;
}

function DropdownItem(props: DropdownItemProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteDropdownMenu.Item
      class={cn(ROW_CLASS, local.class)}
      closeOnSelect={props.closeOnSelect}
      {...rest}
    />
  );
}

function DropdownTrigger(props: DropdownTriggerProps) {
  return (
    <KobalteDropdownMenu.Trigger
      variant="outline"
      as={Button}
      size="sm"
      {...props}
    />
  );
}

export const Dropdown = Object.assign(
  (props: ComponentProps<typeof KobalteDropdownMenu>) => (
    <KobalteDropdownMenu gutter={4} {...props} />
  ),
  {
    RadioGroup:
      KobalteDropdownMenu.RadioGroup /* passthrough — pure logical wrapper */,
    Separator:
      KobalteDropdownMenu.Separator /* passthrough — styled via class at use sites */,
    ItemIndicator: DropdownItemIndicator,
    CheckboxItem: DropdownCheckboxItem,
    SubContent: DropdownSubContent,
    SubTrigger: DropdownSubTrigger,
    GroupLabel: DropdownGroupLabel,
    RadioItem: DropdownRadioItem,
    Content: DropdownContent,
    Trigger: DropdownTrigger,
    Group: DropdownGroup,
    Item: DropdownItem,
    Sub: DropdownSub,
  }
);
