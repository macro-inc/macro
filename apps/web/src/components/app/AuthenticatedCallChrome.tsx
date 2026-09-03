import { useIncomingCallWidgetVisible } from '@app/features/block-call/sidebar/incoming-calls';
import { useCallContextOptional } from '@channel/Call/CallContext';
import type { SidebarState } from '@components/app/app-sidebar/sidebar';
import { useSidebarNextFlag } from '@components/app/sidebar-next/use-sidebar-next-flag';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  lazy,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';

const InCallPanel = lazy(() =>
  import('@channel/Call/InCallPanel').then((module) => ({
    default: module.InCallPanel,
  }))
);
const SidebarActiveCallWidget = lazy(() =>
  import('@app/features/block-call/sidebar/active-call-widget').then(
    (module) => ({
      default: module.SidebarActiveCallWidget,
    })
  )
);

function DraggableCallWidget(props: {
  visible: boolean;
  dragLabel: string;
  defaultBottomGap?: number;
  children: JSX.Element;
}) {
  const EDGE_GAP = 12;
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [dragging, setDragging] = createSignal(false);
  const [position, setPosition] = createSignal<{ left: number; top: number }>();
  const defaultBottomGap = () => props.defaultBottomGap ?? 12;

  const clampPosition = (next: { left: number; top: number }) => {
    const el = root();
    if (!el) return next;

    const maxLeft = Math.max(
      EDGE_GAP,
      window.innerWidth - el.offsetWidth - EDGE_GAP
    );
    const maxTop = Math.max(
      EDGE_GAP,
      window.innerHeight - el.offsetHeight - EDGE_GAP
    );

    return {
      left: Math.min(Math.max(next.left, EDGE_GAP), maxLeft),
      top: Math.min(Math.max(next.top, EDGE_GAP), maxTop),
    };
  };

  const resetToDefaultPosition = (bottomGap = defaultBottomGap()) => {
    const el = root();
    if (!el) return;
    setPosition(
      clampPosition({
        left: Math.round((window.innerWidth - el.offsetWidth) / 2),
        top: window.innerHeight - el.offsetHeight - bottomGap,
      })
    );
  };

  createEffect(() => {
    if (!props.visible) return;
    const bottomGap = defaultBottomGap();
    requestAnimationFrame(() => resetToDefaultPosition(bottomGap));
  });

  createEffect(() => {
    if (!props.visible || !position()) return;

    const handleResize = () => {
      const next = position();
      if (!next) return;
      setPosition(clampPosition(next));
    };

    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    onCleanup(() => {
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    });
  });

  // Set while a drag is in flight so hiding/unmounting can tear it down; a
  // cancelled pointer (touch interrupted, pointer takeover) never fires
  // pointerup, which would otherwise leave the move listener stuck on window.
  let stopActiveDrag: (() => void) | undefined;

  const startDrag: JSX.EventHandler<HTMLButtonElement, PointerEvent> = (e) => {
    if (!e.isPrimary || e.button !== 0) return;

    const el = root();
    if (!el) return;

    stopActiveDrag?.();
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const pointerStartX = e.clientX;
    const pointerStartY = e.clientY;
    const origin = { left: rect.left, top: rect.top };

    setDragging(true);
    setPosition(origin);

    const handleMove = (moveEvent: PointerEvent) => {
      setPosition(
        clampPosition({
          left: origin.left + (moveEvent.clientX - pointerStartX),
          top: origin.top + (moveEvent.clientY - pointerStartY),
        })
      );
    };

    const stopDrag = () => {
      setDragging(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
      if (stopActiveDrag === stopDrag) stopActiveDrag = undefined;
    };
    stopActiveDrag = stopDrag;

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
  };

  createEffect(() => {
    if (!props.visible) stopActiveDrag?.();
  });
  onCleanup(() => stopActiveDrag?.());

  return (
    <Show when={props.visible}>
      <div
        ref={setRoot}
        class="fixed z-float w-72 max-w-[calc(100vw-1.5rem)] pointer-events-auto"
        style={{
          left: position() ? `${position()!.left}px` : '50%',
          top: position() ? `${position()!.top}px` : undefined,
          bottom: position() ? undefined : `${defaultBottomGap()}px`,
          transform: position() ? undefined : 'translateX(-50%)',
        }}
      >
        <div class="relative rounded-xl border border-edge-muted bg-surface shadow-menu p-1">
          <button
            type="button"
            aria-label={props.dragLabel}
            class={cn(
              'absolute left-1 right-10 top-1 z-10 h-8 rounded-t-lg rounded-b-md bg-transparent select-none',
              dragging() ? 'cursor-grabbing' : 'cursor-grab'
            )}
            onPointerDown={startDrag}
          />
          <Suspense>{props.children}</Suspense>
        </div>
      </div>
    </Show>
  );
}

function CollapsedSidebarCallWidget(props: { visible: boolean }) {
  return (
    <DraggableCallWidget
      visible={props.visible}
      dragLabel="Drag to move active call controls"
    >
      <InCallPanel isSlim={() => false} />
    </DraggableCallWidget>
  );
}

function CollapsedSidebarIncomingCallWidget(props: {
  visible: boolean;
  activeCallWidgetVisible: boolean;
}) {
  return (
    <DraggableCallWidget
      visible={props.visible}
      dragLabel="Drag to move incoming calls"
      defaultBottomGap={props.activeCallWidgetVisible ? 168 : 12}
    >
      <SidebarActiveCallWidget sidebarState="expanded" />
    </DraggableCallWidget>
  );
}

export function AuthenticatedCallChrome(props: {
  sidebarVisible: boolean;
  sidebarState: SidebarState;
}) {
  const callCtx = useCallContextOptional();
  const incomingCallWidgetVisible = useIncomingCallWidgetVisible();
  const sidebarNextEnabled = useSidebarNextFlag();
  // SidebarRail has no slim mode, so collapsed call widgets stay off under it.
  const slimChromeVisible = () =>
    !sidebarNextEnabled() &&
    props.sidebarVisible &&
    props.sidebarState === 'slim';
  const activeCallWidgetVisible = createMemo(
    () => slimChromeVisible() && !!callCtx?.isInCall() && !callCtx?.isCallPage()
  );

  return (
    <>
      <CollapsedSidebarIncomingCallWidget
        visible={slimChromeVisible() && incomingCallWidgetVisible()}
        activeCallWidgetVisible={activeCallWidgetVisible()}
      />
      <CollapsedSidebarCallWidget visible={activeCallWidgetVisible()} />
    </>
  );
}
