import { t } from '@app/lib/i18n';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitPanel } from '@components/app/split-panel';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import ListIcon from '@icon/system/regular/list.svg';
import SidebarIcon from '@icon/system/regular/sidebar-simple.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, cn } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { type ComponentProps, Show, splitProps, useContext } from 'solid-js';
import { VIEW_SHELL_TOUR } from './tour';
import {
  ViewShellContext,
  ViewShellPaneContext,
  ViewShellReturnToListContext,
} from './view-shell-context';

/** Keep split close available in both docked and overlay navigation. */
export function ViewSidebarCloseButton(
  props: ComponentProps<typeof SplitPanel.CloseButton>
) {
  const [local, rest] = splitProps(props, ['children', 'size']);
  return (
    <SplitPanel.CloseButton {...rest} size={local.size ?? 'icon-xs'}>
      {local.children ?? <CloseIcon class="size-4" />}
    </SplitPanel.CloseButton>
  );
}

/** Safe outside a shell so block preview headers can share this control. */
export function ViewSidebarToggle(props: {
  action: 'collapse' | 'expand';
  presentation?: 'pill';
}) {
  const ws = useContext(ViewShellContext);
  const pane = useContext(ViewShellPaneContext);
  // A conditional expression as `ref` is dropped by the Solid compiler, so
  // only the expand toggle registers, from inside the callback.
  const toggleTarget = tourTarget(VIEW_SHELL_TOUR.sidebarToggle);
  const label = () =>
    ws?.aside.isSheet()
      ? props.action === 'expand'
        ? 'Show sidebar'
        : 'Hide sidebar'
      : props.action === 'expand'
        ? 'Show navigation'
        : 'Hide navigation';
  // A touch sheet or overlay closes from its backdrop; it shows no Hide.
  const dismissesFromBackdrop = () =>
    ws?.aside.isSheet() || (isTouchDevice() && ws?.aside.isOverlay());
  const visible = () =>
    !(ws?.collectionLayout() && pane === 'detail') &&
    ws?.aside.canCollapse() &&
    (props.action === 'expand'
      ? ws.aside.isCollapsed() || ws.aside.isOverlay()
      : !ws.aside.isCollapsed() && !dismissesFromBackdrop());
  // Show and Hide are separate actions, not a persistently pressed toggle.
  return (
    <Show when={visible()}>
      <Button
        aria-label={label()}
        tooltip={{
          content: label(),
          hotkey: TOKENS.workspace.toggleNavigation,
        }}
        variant="ghost"
        size={props.presentation === 'pill' ? 'icon-md' : 'icon-xs'}
        class={cn(
          'shrink-0',
          // The same island as the touch filter button beside it.
          props.presentation === 'pill' &&
            'island bg-chrome-glass pointer-events-auto relative size-10 rounded-full',
          props.action === 'collapse' && 'ml-auto',
          props.action === 'collapse' &&
            ws?.aside.isOverlay() &&
            'motion-safe:animate-[dialog-overlay-open_60ms_ease-out_80ms_both]'
        )}
        ref={(element) => {
          if (props.action === 'expand') {
            toggleTarget(element);
            ws?.registerNavigationTrigger(element);
          }
        }}
        data-view-sidebar-toggle={props.action}
        onClick={() => {
          const shell = ws?.root();
          if (props.action === 'expand') ws?.aside.expand();
          else ws?.aside.collapse();
          const nextAction = props.action === 'expand' ? 'collapse' : 'expand';
          if (ws?.aside.isSheet()) return;
          queueMicrotask(() =>
            shell
              ?.querySelector<HTMLButtonElement>(
                `[data-view-sidebar-toggle="${nextAction}"]`
              )
              ?.focus({ preventScroll: true })
          );
        }}
      >
        {/* Touch opens navigation as a sheet, behind the familiar menu icon. */}
        <Show when={isTouchDevice()} fallback={<SidebarIcon class="size-4" />}>
          <ListIcon
            class={props.presentation === 'pill' ? 'size-6 shrink-0' : 'size-4'}
          />
        </Show>
      </Button>
    </Show>
  );
}

/** Takes a narrow list view from the open entity back to its list. */
function ViewListBackButton(props: { onClick: () => void }) {
  return (
    <HeaderIsland class="px-1">
      <Button
        aria-label={t('common.back')}
        tooltip={t('common.back')}
        variant="ghost"
        size="icon-xs"
        class="shrink-0"
        // The way out of an inline preview is reachable before it is used.
        data-allow-focus-in-preview
        onClick={() => props.onClick()}
      >
        <ArrowLeftIcon class="size-4 touch:size-6" />
      </Button>
    </HeaderIsland>
  );
}

/** Shared leading controls, kept in place beneath navigation overlays. */
export function ViewNavigationControls() {
  const returnToList = useContext(ViewShellReturnToListContext);
  return (
    <Show
      when={returnToList?.()}
      keyed
      fallback={<SidebarNavigationControls />}
    >
      {(onBack) => (
        <ViewListBackButton
          onClick={() => fireAndForget(onBack(), 'workspace-back')}
        />
      )}
    </Show>
  );
}

function SidebarNavigationControls() {
  const ws = useContext(ViewShellContext);
  const pane = useContext(ViewShellPaneContext);
  return (
    <Show
      when={
        !(ws?.collectionLayout() && pane === 'detail') &&
        (ws?.aside.isCollapsed() || ws?.aside.isOverlay())
      }
    >
      <SplitPanel.ControlGroup
        class="pointer-events-auto"
        inert={ws?.aside.isOverlay()}
        aria-hidden={ws?.aside.isOverlay()}
      >
        <SplitPanel.CloseButton />
        <Show
          when={ws?.narrowList() === 'main'}
          fallback={
            <ViewSidebarToggle
              action="expand"
              presentation={isTouchDevice() ? 'pill' : undefined}
            />
          }
        >
          <ViewListBackButton onClick={() => ws?.returnToList()} />
        </Show>
      </SplitPanel.ControlGroup>
    </Show>
  );
}
