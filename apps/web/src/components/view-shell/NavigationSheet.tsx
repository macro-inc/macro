import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { type JSX, splitProps } from 'solid-js';
import { useViewShellInternal } from './view-shell-context';

/** Sub-view navigation never takes a column away from a touch collection. */
export function NavigationSheet(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const ws = useViewShellInternal();
  return (
    <MobileDrawer
      open={ws.aside.isOverlay()}
      onOpenChange={(open) => (open ? ws.aside.expand() : ws.aside.collapse())}
      restoreFocus
      finalFocusEl={ws.navigationTrigger()}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label="Sidebar"
          targetHeight={80}
          maxHeight={88}
        >
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody
            class="overflow-hidden"
            style={{ '--safe-top': '0px' }}
          >
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
