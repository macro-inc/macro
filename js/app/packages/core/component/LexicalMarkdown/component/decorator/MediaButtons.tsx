import { isMobile } from '@core/mobile/isMobile';
import { Dialog } from '@kobalte/core/dialog';
import NewTab from '@phosphor/arrow-square-out.svg';
import ArrowsOut from '@phosphor/arrows-out-simple.svg';
import ThreeDotsIcon from '@phosphor/dots-three.svg';
import Trash from '@phosphor/trash.svg';
import { Button, Dropdown, Layer } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

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
          <Dropdown
            open={menuOpen()}
            onOpenChange={setMenuOpen}
            placement="bottom-end"
          >
            <Dropdown.Trigger
              size="icon-sm"
              variant="ghost"
              tooltip="More options"
            >
              <ThreeDotsIcon />
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.Group>
                <Show when={props.enlarge}>
                  <Dropdown.Item
                    onSelect={() => {
                      props.enlarge?.();
                      setMenuOpen(false);
                    }}
                  >
                    <ArrowsOut class="size-4 shrink-0" />
                    <span class="flex-1 truncate">View full screen</span>
                  </Dropdown.Item>
                </Show>
                <Show when={props.newTab && !isMobile()}>
                  <Dropdown.Item
                    onSelect={() => {
                      props.newTab?.();
                      setMenuOpen(false);
                    }}
                  >
                    <NewTab class="size-4 shrink-0" />
                    <span class="flex-1 truncate">Open in new tab</span>
                  </Dropdown.Item>
                </Show>
              </Dropdown.Group>
              <Show when={props.delete}>
                <Dropdown.Group>
                  <Dropdown.Item
                    onSelect={() => {
                      props.delete?.();
                      setMenuOpen(false);
                    }}
                  >
                    <Trash class="size-4 shrink-0 text-failure" />
                    <span class="flex-1 truncate">Remove</span>
                  </Dropdown.Item>
                </Dropdown.Group>
              </Show>
            </Dropdown.Content>
          </Dropdown>
        </Show>
      </div>
    </Layer>
  );
}
