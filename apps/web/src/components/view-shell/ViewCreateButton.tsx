import CaretDownIcon from '@phosphor/caret-down.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, type ButtonProps, cn } from '@ui';
import { Show, splitProps } from 'solid-js';
import { ViewSidebar } from './ViewSidebar';

/** Shared desktop New action, including polymorphic dropdown triggers. */
export function ViewCreateButton(
  props: ButtonProps & {
    presentation?: 'sidebar' | 'toolbar';
    menu?: boolean;
  }
) {
  const [local, rest] = splitProps(props, [
    'presentation',
    'menu',
    'class',
    'children',
  ]);
  const sidebar = () => local.presentation === 'sidebar';

  return (
    <Button
      {...rest}
      variant="outline"
      size="md"
      class={cn(
        sidebar() &&
          'h-(--sidebar-row-height) w-full min-w-0 justify-start gap-(--sidebar-label-gap) px-(--sidebar-item-inset) text-left',
        local.class
      )}
    >
      <Show when={sidebar()} fallback={<PlusIcon class="size-4" />}>
        <ViewSidebar.Icon>
          <PlusIcon class="size-4" />
        </ViewSidebar.Icon>
      </Show>
      <span class="truncate">New</span>
      <Show when={local.menu}>
        <Show when={sidebar()} fallback={<CaretDownIcon class="size-3" />}>
          <ViewSidebar.Trailing>
            <CaretDownIcon class="size-3" />
          </ViewSidebar.Trailing>
        </Show>
      </Show>
    </Button>
  );
}
