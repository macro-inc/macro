import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { autoUpdate } from '@floating-ui/dom';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  splitProps,
} from 'solid-js';
import { useViewShellInternal } from './view-shell-context';

/** A narrow sheet's share of the screen, so its rows read at a glance. */
const NARROW_SHEET_SCREEN_SHARE = 0.75;
const NARROW_SHEET_MIN_WIDTH = 256;

/** Three quarters of the screen, at least 256px, within the workspace. */
function narrowSheetWidth(workspaceWidth: number) {
  return Math.min(
    workspaceWidth,
    Math.max(
      NARROW_SHEET_MIN_WIDTH,
      window.innerWidth * NARROW_SHEET_SCREEN_SHARE
    )
  );
}

/** Sub-view navigation never takes a column away from a touch collection. */
export function NavigationSheet(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const ws = useViewShellInternal();
  const [sheet, setSheet] = createSignal<HTMLElement>();
  const [bounds, setBounds] = createSignal<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>();
  const list = createMemo(() => {
    if (!ws.aside.isOverlay()) return;
    const root = ws.root();
    if (!ws.collectionLayout()) return root;
    return (
      root?.querySelector<HTMLElement>('[data-view-shell-list]') ??
      root?.querySelector<HTMLElement>('[data-view-shell-main]')
    );
  });
  const measure = () => {
    const frame = list();
    if (!frame) return;
    const { left, top, width, height } = frame.getBoundingClientRect();
    setBounds({
      left,
      top,
      width: ws.collectionLayout() ? width : narrowSheetWidth(width),
      height,
    });
  };
  createEffect(
    on([list, sheet], ([frame, content]) => {
      if (!frame || !content) return;
      measure();
      onCleanup(autoUpdate(frame, content, measure, { animationFrame: true }));
    })
  );
  return (
    <MobileDrawer
      side="left"
      open={ws.aside.isOverlay()}
      onOpenChange={(open) => (open ? ws.aside.expand() : ws.aside.collapse())}
      restoreFocus
      finalFocusEl={ws.navigationTrigger()}
    >
      <MobileDrawer.Portal mount={document.body}>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          ref={(element: HTMLDivElement) => {
            setSheet(element);
            onCleanup(() =>
              setSheet((current) => (current === element ? undefined : current))
            );
          }}
          aria-label="Sidebar"
          style={{
            left: `${bounds()?.left ?? 0}px`,
            top: `${bounds()?.top ?? 0}px`,
            width: `${bounds()?.width ?? ws.aside.layout().width}px`,
            height: `${bounds()?.height ?? 0}px`,
            bottom: 'auto',
          }}
        >
          <MobileDrawer.ScrollBody class="overflow-hidden">
            <div
              {...rest}
              class={
                local.class
                  ? `flex min-h-0 flex-1 flex-col ${local.class}`
                  : 'flex min-h-0 flex-1 flex-col'
              }
              data-view-shell-aside
              data-view-shell-navigation-sheet
            >
              {local.children}
            </div>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
