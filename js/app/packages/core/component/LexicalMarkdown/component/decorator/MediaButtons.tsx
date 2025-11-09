import { IconButton } from '@core/component/IconButton';
import {
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/Menu';
import clickOutside from '@core/directive/clickOutside';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import NewTab from '@icon/regular/arrow-square-out.svg';
import ArrowsOut from '@icon/regular/arrows-out-simple.svg';
import ThreeDotsIcon from '@icon/regular/dots-three.svg';
import Trash from '@icon/regular/trash.svg';
import { Dialog } from '@kobalte/core/dialog';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

false && clickOutside;

const COLLAPSE_WIDTH = 120;

export interface MediaButtonsProps {
  delete?: () => void;
  enlarge?: () => void;
  newTab?: () => void;
  containerRef?: HTMLElement;
}

export function MediaButtons(props: MediaButtonsProps) {
  const [collapsed, setCollapsed] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);

  onMount(() => {
    if (props.containerRef) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect.width;
          setCollapsed(width < COLLAPSE_WIDTH);
        }
      });
      resizeObserver.observe(props.containerRef);
      onCleanup(() => {
        if (resizeObserver) {
          resizeObserver.disconnect();
        }
      });
    }
  });

  const ButtonContent = () => (
    <>
      <Show when={props.enlarge}>
        <Dialog.Trigger>
          <IconButton
            class="m-0"
            icon={() => <ArrowsOut class="size-5" />}
            tooltip={{ label: 'View full screen' }}
            onClick={(e: MouseEvent | KeyboardEvent) => {
              e.preventDefault();
              props.enlarge && props.enlarge();
            }}
          />
        </Dialog.Trigger>
      </Show>
      <Show when={props.newTab && !isMobileWidth() && !isTouchDevice}>
        <IconButton
          class="m-0"
          icon={() => <NewTab class="size-5" />}
          tooltip={{ label: 'Open in new tab' }}
          onClick={(e: MouseEvent | KeyboardEvent) => {
            e.preventDefault();
            props.newTab && props.newTab();
          }}
        />
      </Show>
      <Show when={props.delete}>
        <IconButton
          class="m-0"
          icon={() => <Trash class="size-5" />}
          tooltip={{ label: 'Remove' }}
          onClick={(e: MouseEvent | KeyboardEvent) => {
            e.preventDefault();
            props.delete && props.delete();
          }}
        />
      </Show>
    </>
  );

  return (
    <div class="absolute bg-menu top-2 right-2 flex flex-row">
      <Show when={!collapsed()}>
        <ButtonContent />
      </Show>
      <Show when={collapsed()}>
        <DropdownMenu
          open={menuOpen()}
          onOpenChange={setMenuOpen}
          placement="bottom-end"
        >
          <DropdownMenu.Trigger>
            <IconButton
              class="m-0"
              icon={() => <ThreeDotsIcon class="size-4" />}
              tooltip={{ label: 'More options' }}
            />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenuContent>
              <div
                use:clickOutside={(e) => {
                  const target = e.target as HTMLElement;
                  const menu = target.closest('.submenu');
                  if (!menu) {
                    setMenuOpen(false);
                  }
                }}
                class="w-full"
              >
                <Show when={props.enlarge}>
                  <MenuItem
                    text="View full screen"
                    icon={ArrowsOut}
                    onClick={() => {
                      props.enlarge && props.enlarge();
                      setMenuOpen(false);
                    }}
                  />
                </Show>
                <Show when={props.newTab && !isMobileWidth() && !isTouchDevice}>
                  <MenuItem
                    text="Open in new tab"
                    icon={NewTab}
                    onClick={() => {
                      props.newTab && props.newTab();
                      setMenuOpen(false);
                    }}
                  />
                </Show>
                <Show when={props.delete}>
                  <MenuSeparator />
                  <MenuItem
                    text="Remove"
                    icon={Trash}
                    iconClass="text-failure"
                    onClick={() => {
                      props.delete && props.delete();
                      setMenuOpen(false);
                    }}
                  />
                </Show>
              </div>
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </Show>
    </div>
  );
}
