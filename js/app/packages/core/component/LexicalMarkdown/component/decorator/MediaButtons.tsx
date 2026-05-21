import {
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/Menu';
import clickOutside from '@core/directive/clickOutside';
import { isMobile } from '@core/mobile/isMobile';
import { Dialog } from '@kobalte/core/dialog';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import NewTab from '@phosphor/arrow-square-out.svg';
import ArrowsOut from '@phosphor/arrows-out-simple.svg';
import ThreeDotsIcon from '@phosphor/dots-three.svg';
import Trash from '@phosphor/trash.svg';
import { Button, Layer } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

false && clickOutside;

const COLLAPSE_WIDTH = 120;

interface MediaButtonsProps {
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
        <Dialog.Trigger
          as={Button}
          variant="ghost"
          size="icon-sm"
          tooltip="View full screen"
          on:mousedown={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            props.enlarge?.();
          }}
        >
          <ArrowsOut />
        </Dialog.Trigger>
      </Show>
      <Show when={props.newTab && !isMobile()}>
        <Button
          variant="ghost"
          size="icon-sm"
          tooltip="Open in new tab"
          on:mousedown={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            props.newTab?.();
          }}
        >
          <NewTab />
        </Button>
      </Show>
      <Show when={props.delete}>
        <Button
          variant="ghost"
          size="icon-sm"
          tooltip="Remove"
          on:mousedown={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            props.delete?.();
          }}
        >
          <Trash />
        </Button>
      </Show>
    </>
  );

  return (
    <Layer depth={3}>
      <div class="absolute bg-surface ring ring-edge rounded-md top-2 right-2 flex flex-row p-1">
        <Show when={!collapsed()}>
          <ButtonContent />
        </Show>
        <Show when={collapsed()}>
          <DropdownMenu
            open={menuOpen()}
            onOpenChange={setMenuOpen}
            placement="bottom-end"
          >
            <DropdownMenu.Trigger
              as={Button}
              size="icon-sm"
              variant="ghost"
              tooltip="More options"
            >
              <ThreeDotsIcon />
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
                        props.enlarge?.();
                        setMenuOpen(false);
                      }}
                    />
                  </Show>
                  <Show when={props.newTab && !isMobile()}>
                    <MenuItem
                      text="Open in new tab"
                      icon={NewTab}
                      onClick={() => {
                        props.newTab?.();
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
                        props.delete?.();
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
    </Layer>
  );
}
