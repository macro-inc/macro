import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { cn } from '@ui';
import {
  children,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { SidePanel, useSidePanel } from '../side-panel';
import {
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '../split-layout/layoutUtils';
import { MobileHeaderIsland } from './island';

/**
 * The header of a mobile view: `children` on the left, `trailing` on the
 * right, each built from islands. Back comes from the shell.
 *
 * While it is mounted it owns the pane's header: `SplitHeaderLeft` /
 * `SplitHeaderRight` contributions from anywhere else in the pane render
 * nothing, so the header shows only what the mobile view composes here.
 */
function MobileHeaderRoot(props: ParentProps<{ trailing?: JSX.Element }>) {
  const panel = useSplitPanelOrThrow();
  const [, setOwner] = panel.mobileHeaderOwner;
  const owner = Symbol('mobile-header');

  setOwner(owner);
  onCleanup(() =>
    setOwner((current) => (current === owner ? undefined : current))
  );

  return (
    <>
      <Show when={panel.layoutRefs.headerLeft}>
        <Portal
          mount={panel.layoutRefs.headerLeft}
          ref={(div) => (div.style.display = 'contents')}
        >
          {props.children}
        </Portal>
      </Show>
      <Show when={panel.layoutRefs.headerRight}>
        <Portal
          mount={panel.layoutRefs.headerRight}
          ref={(div) => (div.style.display = 'contents')}
        >
          {props.trailing}
        </Portal>
      </Show>
    </>
  );
}

/**
 * The view's title island. It names the pane, and a tap opens the title menu
 * when the view renders one.
 */
function Title(props: {
  label: string;
  iconType?: EntityIconSelector;
  /** Replaces the entity icon when it renders something, e.g. the session's model. */
  icon?: JSX.Element;
  /** Shown between the icon and the label, such as the file type. */
  badges?: JSX.Element;
  colorIcon?: boolean;
  class?: string;
}) {
  const panel = useSplitPanelOrThrow();
  const icon = children(() => props.icon);
  useSplitDisplayName(() => props.label);

  const openTitleMenu = (event: MouseEvent) => {
    const trigger = panel.titleFileMenuTrigger();
    if (!trigger) return;

    event.preventDefault();
    event.stopPropagation();
    trigger();
  };

  return (
    <MobileHeaderIsland class="shrink" onClick={openTitleMenu}>
      <div
        class={cn(
          'z-split-header-content relative flex h-full max-w-full shrink items-center gap-1.5',
          props.class
        )}
      >
        <Show
          when={icon.toArray().length > 0}
          fallback={
            <Show when={props.iconType}>
              <EntityIcon
                class="shrink-0"
                targetType={props.iconType}
                size="xs"
                theme={props.colorIcon ? undefined : 'monochrome'}
              />
            </Show>
          }
        >
          <div class="flex shrink-0 items-center justify-center">{icon()}</div>
        </Show>
        {props.badges}
        <span class="inline-flex min-w-0 items-center gap-1">
          <span class="inline-block truncate text-sm font-semibold">
            {props.label}
          </span>
          <Show when={panel.titleFileMenuTrigger()}>
            <CaretDownIcon class="size-3.5 shrink-0 text-ink-muted" />
          </Show>
        </span>
      </div>
    </MobileHeaderIsland>
  );
}

/** Opens the pane's details drawer. Renders nothing without details. */
function Info() {
  const sidePanel = useSidePanel();

  return (
    <Show when={sidePanel?.hasSections()}>
      <MobileHeaderIsland
        class={cn(
          'size-10 justify-center !px-0',
          sidePanel?.isOpen() && 'text-accent'
        )}
      >
        <SidePanel.Toggle />
      </MobileHeaderIsland>
    </Show>
  );
}

export const MobileHeader = Object.assign(MobileHeaderRoot, {
  Title,
  Island: MobileHeaderIsland,
  Info,
});
