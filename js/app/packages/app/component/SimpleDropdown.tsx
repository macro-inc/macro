import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from '@floating-ui/dom';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { cn } from '@ui';
import {
  type Accessor,
  type Component,
  createContext,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
  splitProps,
  useContext,
  type ValidComponent,
} from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';

// SimpleDropdown is a hand-rolled dropdown with no focus management — Kobalte's
// DropdownMenu unconditionally restores focus to its trigger on close, which
// conflicts with MobileDrawer focus control. Use SimpleDropdown (via
// ResponsiveDropdown) on touch devices wherever you need to own focus yourself.

// --- Internal floating content ---

function FloatingContent(props: {
  anchor: HTMLElement;
  boundary: HTMLElement | null;
  onClose: () => void;
  children: JSX.Element;
  class?: string;
}) {
  let ref!: HTMLDivElement;
  const [pos, setPos] = createSignal({ x: 0, y: 0 });

  onMount(() => {
    const update = async () => {
      const { x, y } = await computePosition(props.anchor, ref, {
        strategy: 'fixed',
        placement: 'bottom-end',
        middleware: [
          offset(8),
          flip({
            boundary: props.boundary ?? 'clippingAncestors',
            fallbackStrategy: 'initialPlacement',
          }),
          shift({
            padding: 8,
            boundary: props.boundary ?? 'clippingAncestors',
          }),
        ],
      });
      setPos({ x, y });
    };

    const cleanupAutoUpdate = autoUpdate(props.anchor, ref, update);

    const handlePointerDown = (e: PointerEvent) => {
      if (
        !ref.contains(e.target as Node) &&
        !props.anchor.contains(e.target as Node)
      ) {
        props.onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    onCleanup(() => {
      cleanupAutoUpdate();
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left: `${pos().x}px`, top: `${pos().y}px` }}
      class={cn(
        'bg-surface w-fit p-1.5 rounded-xl ring-1 ring-edge shadow-[0_8px_24px_-16px_rgba(0,0,0,0.24),0_2px_8px_-6px_rgba(0,0,0,0.18)] z-highlight-menu',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

// --- Context ---

type SimpleDropdownContextValue = {
  open: Accessor<boolean>;
  onOpenChange: (open: boolean) => void;
  boundary: Accessor<HTMLElement | null>;
  anchor: Accessor<HTMLElement | undefined>;
  setAnchor: (el: HTMLElement) => void;
};

const SimpleDropdownContext = createContext<SimpleDropdownContextValue>();

function useSimpleDropdownContext() {
  const ctx = useContext(SimpleDropdownContext);
  if (!ctx)
    throw new Error(
      'SimpleDropdown sub-components must be used inside <SimpleDropdown>'
    );
  return ctx;
}

// --- Item ---

export type DropdownItemProps = {
  text: string | JSX.Element;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  onClick?: (e?: MouseEvent) => void;
  disabled?: boolean;
  class?: string;
};

const ITEM_BASE_CLASS = `flex flex-row w-full gap-1.5 tracking-tight ${isMobile() ? 'py-2 px-1.5 text-base' : 'py-1 pl-2.5 pr-2 text-sm'} font-medium justify-between items-center rounded-md outline-none focus:bg-ink/3 data-[highlighted]:bg-ink/3`;

function ItemInner(props: Pick<DropdownItemProps, 'icon' | 'text'>) {
  return (
    <>
      <Show when={props.icon}>
        <Dynamic
          component={props.icon}
          class={cn('shrink-0', isMobile() ? 'size-5' : 'size-4')}
        />
      </Show>
      <Show when={props.text}>
        <div class="flex-1 truncate">{props.text}</div>
      </Show>
    </>
  );
}

function TouchItem(props: DropdownItemProps) {
  return (
    <div
      onClick={(e) => props.onClick?.(e)}
      class={cn(
        ITEM_BASE_CLASS,
        props.disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:bg-ink/3 hover-transition-bg',
        props.class
      )}
    >
      <ItemInner icon={props.icon} text={props.text} />
    </div>
  );
}

function KobalteItem(props: DropdownItemProps) {
  return (
    <DropdownMenu.Item
      onSelect={props.onClick}
      disabled={props.disabled}
      class={cn(
        ITEM_BASE_CLASS,
        props.disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:bg-ink/3 hover-transition-bg',
        props.class
      )}
    >
      <ItemInner icon={props.icon} text={props.text} />
    </DropdownMenu.Item>
  );
}

const DropdownItem = isTouchDevice() ? TouchItem : KobalteItem;

// --- Sub-components ---

function SimpleDropdownTrigger(props: {
  as?: ValidComponent;
  onClick?: (e: MouseEvent) => void;
  children?: JSX.Element;
  [key: string]: unknown;
}) {
  const ctx = useSimpleDropdownContext();
  const [local, others] = splitProps(props, ['as', 'onClick']);
  return (
    <Dynamic
      component={(local.as ?? 'button') as ValidComponent}
      ref={(el: HTMLElement) => ctx.setAnchor(el)}
      onClick={(e: MouseEvent) => {
        local.onClick?.(e);
        ctx.onOpenChange(!ctx.open());
      }}
      {...(others as Record<string, unknown>)}
    />
  );
}

// No-op: portaling is handled internally by Content.
function SimpleDropdownPortal(props: { children: JSX.Element }) {
  return <>{props.children}</>;
}

function SimpleDropdownContent(props: {
  class?: string;
  children: JSX.Element;
}) {
  const ctx = useSimpleDropdownContext();
  return (
    <Show when={ctx.open() && ctx.anchor()}>
      <Portal>
        <FloatingContent
          anchor={ctx.anchor()!}
          boundary={ctx.boundary()}
          onClose={() => ctx.onOpenChange(false)}
          class={props.class}
        >
          {props.children}
        </FloatingContent>
      </Portal>
    </Show>
  );
}

// --- Root ---

function SimpleDropdownRoot(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boundary?: Accessor<HTMLElement | null>;
  children: JSX.Element;
}) {
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  return (
    <SimpleDropdownContext.Provider
      value={{
        open: () => props.open,
        onOpenChange: props.onOpenChange,
        boundary: props.boundary ?? (() => null),
        anchor,
        setAnchor,
      }}
    >
      {props.children}
    </SimpleDropdownContext.Provider>
  );
}

export const SimpleDropdown = Object.assign(SimpleDropdownRoot, {
  Trigger: SimpleDropdownTrigger,
  Portal: SimpleDropdownPortal,
  Content: SimpleDropdownContent,
  Item: DropdownItem,
});

export type DropdownMenuLike = {
  (props: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    boundary?: unknown;
    children: JSX.Element;
  }): JSX.Element;
  Trigger: Component<any>;
  Portal: Component<any>;
  Content: Component<any>;
  Item: Component<any>;
};

// On desktop: use Kobalte's root/trigger/portal/content (for keyboard nav and
// focus management) but replace Item with the wrapped KobalteItem so that
// callers can use the text/icon/onClick interface.
const DesktopDropdown = Object.assign(
  (props: any) => {
    const [, others] = splitProps(props, ['boundary']);
    return <DropdownMenu {...others} />;
  },
  {
    Trigger: DropdownMenu.Trigger,
    Portal: DropdownMenu.Portal,
    Content: DropdownMenu.Content,
    Item: KobalteItem,
  }
);

export const ResponsiveDropdown: DropdownMenuLike = isTouchDevice()
  ? (SimpleDropdown as unknown as DropdownMenuLike)
  : (DesktopDropdown as unknown as DropdownMenuLike);
