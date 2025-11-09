import { BrightJoins } from '@core/component/BrightJoins';
import { IconButton } from '@core/component/IconButton';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { TOKENS } from '@core/hotkey/tokens';
import CloseIcon from '@icon/regular/x.svg';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { useSplitPanel } from '../layoutUtils';
import { useDrawerControl, useDrawerGroup } from './SplitDrawerContext';

const BUFFER_SIZE = 48; // tw 3rem;

function DrawerInner(props: ParentProps<{ id: string }>) {
  const drawerControl = useDrawerControl(props.id);
  const splitPanel = useSplitPanel();

  let ref!: HTMLDivElement;

  if (splitPanel?.splitHotkeyScope) {
    registerHotkey({
      hotkeyToken: TOKENS.drawer.close,
      hotkey: 'escape',
      condition: drawerControl.isOpen,
      scopeId: splitPanel.splitHotkeyScope,
      description: 'Close References Drawer',
      keyDownHandler: (e) => {
        e?.preventDefault();
        drawerControl.close();
        return true;
      },
    });
  }

  return (
    <div class="w-full h-full p-2 overflow-auto shrink" ref={ref}>
      {props.children}
    </div>
  );
}

/**
 * A drawer component that overlays content within a split panel.
 * @param props.size - Target size in pixels for the drawer
 * @param props.side - Which side of the split panel to attach the drawer to
 */
export function SplitDrawer(
  props: ParentProps<{
    id: string;
    side: 'top' | 'bottom' | 'left' | 'right';
    size: number; // Target size in pixels
    title?: JSX.Element;
  }>
) {
  const { panelSize, contentOffsetTop } = useDrawerGroup();
  const drawerControl = useDrawerControl(props.id);
  const isHorizontal = () => props.side === 'left' || props.side === 'right';

  const getConstrainedSize = () => {
    const size = isHorizontal() ? panelSize.width : panelSize.height;
    if (size === null) return `calc(100% - ${BUFFER_SIZE}px)`;
    const constrainedMax = Math.max(0, size - BUFFER_SIZE);
    const constrainedSize = Math.min(constrainedMax, props.size);
    return `${constrainedSize}px`;
  };

  const getPositionClasses = () => {
    const baseClasses = `absolute bg-menu border-edge/50 z-2 flex flex-col`;
    let positionClasses = '';
    switch (props.side) {
      case 'top':
        positionClasses = 'left-px right-px border-b';
        break;
      case 'bottom':
        positionClasses = 'top-unset left-px right-px bottom-px border-t';
        break;
      case 'left':
        positionClasses = 'bottom-px left-px border-r';
        break;
      case 'right':
        positionClasses = 'bottom-px right-px border-l';
        break;
      default:
        break;
    }

    return `${baseClasses} ${positionClasses}`;
  };

  const getSizeStyle = () => {
    const constrainedSize = getConstrainedSize();

    if (isHorizontal()) {
      return { width: constrainedSize, top: `${contentOffsetTop()}px` };
    } else {
      return { height: constrainedSize, top: `${contentOffsetTop()}px` };
    }
  };

  const getGradientMaskClasses = () => {
    const baseClasses = 'absolute pattern-panel pattern-diagonal-4 opacity-100';
    switch (props.side) {
      case 'left':
        return `${baseClasses} h-full w-4 left-0 top-0 -translate-x-[calc(100%_+_1px)] mask-l-from-0`;
      case 'right':
        return `${baseClasses} h-full w-4 left-0 top-0 -translate-x-[calc(100%_+_1px)] mask-l-from-0`;
      case 'top':
        return `${baseClasses} w-full h-4 left-0 top-0 -translate-y-[calc(100%_+_1px)] mask-t-from-0`;
      case 'bottom':
        return `${baseClasses} w-full h-4 left-0 bottom-0 translate-y-[calc(100%_+_1px)] mask-b-from-0`;
      default:
        return baseClasses;
    }
  };

  return (
    <Show when={drawerControl.isOpen()}>
      <ScopedPortal scope="split">
        <div
          class="inset-px bg-modal-overlay absolute transition-opacity ease-in-out pattern-edge"
          style={{ top: `${contentOffsetTop()}px` }}
          onClick={drawerControl.close}
        />
        <div class={getPositionClasses()} style={getSizeStyle()}>
          <div class={getGradientMaskClasses()} />
          <BrightJoins dots={[true, true, true, true]} />
          <div class="flex items-center justify-start gap-2 shrink-0">
            <Show when={props.title}>
              <h3 class="text-md font-medium text-content-secondary shrink truncate m-3">
                {props.title}
              </h3>
            </Show>
            <div class="grow" />
            <IconButton
              icon={CloseIcon}
              theme="clear"
              size="sm"
              tooltip={{ label: 'Close' }}
              onClick={drawerControl.close}
            />
          </div>
          <div class="size-full overflow-hidden">
            <DrawerInner id={props.id}>{props.children}</DrawerInner>
          </div>
        </div>
      </ScopedPortal>
    </Show>
  );
}
