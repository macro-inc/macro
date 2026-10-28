import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import {
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
} from 'solid-js';

/** Closing or resizing either presentation preserves the editor and history. */
export function CallChatPanel(props: {
  id: string;
  open: boolean;
  onClose: () => void;
  children: JSX.Element;
  composer: JSX.Element;
}) {
  const [sidebarBody, setSidebarBody] = createSignal<HTMLDivElement>();
  const [sheetBody, setSheetBody] = createSignal<HTMLDivElement>();
  const sheetOpen = () => isMobile() && props.open;
  const sheetId = () => (isMobile() ? props.id : `${props.id}-sheet`);
  let body!: HTMLDivElement;
  let viewport!: HTMLDivElement;
  let content!: HTMLDivElement;
  let pinned = true;
  let scrollTop = 0;

  // Reparent the existing editor and restore scroll after the new surface is visible.
  createEffect(
    on([isMobile, sidebarBody, sheetBody], ([mobile, sidebar, sheet]) => {
      const target = mobile ? sheet : sidebar;
      if (!target) return;
      target.appendChild(body);
      viewport.scrollTop = scrollTop;
    })
  );

  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (props.open && pinned) {
        viewport.scrollTop = viewport.scrollHeight;
        scrollTop = viewport.scrollTop;
      }
    });
    observer.observe(viewport);
    observer.observe(content);
    onCleanup(() => observer.disconnect());
  });

  return (
    <MobileDrawer
      open={sheetOpen()}
      dialogId={sheetId()}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <aside
        id={isMobile() ? undefined : props.id}
        aria-label="Call chat"
        hidden={isMobile() || !props.open}
        class="absolute inset-y-0 right-0 z-20 w-full max-w-90 min-h-0 flex-col border-l border-edge-muted bg-surface @min-[800px]/call:static @min-[800px]/call:w-90 @min-[800px]/call:shrink-0"
        classList={{ flex: !isMobile() && props.open }}
      >
        <h2 class="flex h-14 shrink-0 items-center px-4 pr-14 text-sm font-medium">
          Call chat
        </h2>
        <div ref={setSidebarBody} class="flex min-h-0 flex-1 flex-col" />
      </aside>
      <MobileDrawer.Portal forceMount>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          forceMount
          aria-hidden={!sheetOpen()}
          inert={!sheetOpen()}
          targetHeight={80}
          class="data-closed:hidden"
        >
          <MobileDrawer.Handle />
          <MobileDrawer.Title class="shrink-0 px-4 pb-2 text-sm font-medium">
            Call chat
          </MobileDrawer.Title>
          <MobileDrawer.ScrollBody ref={setSheetBody} class="overflow-hidden" />
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
      <div
        ref={body}
        class="flex min-h-0 flex-1 flex-col"
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }}
      >
        <div
          ref={viewport}
          data-channel-scroll
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4"
          onScroll={() => {
            if (!props.open || !viewport.clientHeight) return;
            scrollTop = viewport.scrollTop;
            pinned =
              viewport.scrollHeight - scrollTop - viewport.clientHeight < 48;
          }}
        >
          <div ref={content}>{props.children}</div>
        </div>
        <div class="shrink-0 p-3">{props.composer}</div>
      </div>
    </MobileDrawer>
  );
}
