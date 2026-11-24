import { defineDoc } from '@app/features/ui-gallery/types';
import { Menu } from './Menu';
import { Popover } from './Popover';

// #region demo:menu-popover
function MenuPopoverDemo() {
  return (
    <Popover>
      <Popover.Trigger>Choose a model</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="min-w-56">
          <Popover.Title class="sr-only">Models</Popover.Title>
          <Menu.Group aria-label="Models">
            <Menu.Label>Models</Menu.Label>
            <Menu.Item aria-pressed>Current model</Menu.Item>
            <Menu.Item>Another model</Menu.Item>
            <Menu.Item disabled>Unavailable model</Menu.Item>
          </Menu.Group>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

// #endregion

export default defineDoc({
  name: 'Popover',
  category: 'Overlays',
  description:
    'Dialog focus semantics on the same menu surface as Dropdown. Menu parts supply native rows and groups for searchable or mixed-control content.',
  status: 'stable',
  import: "import { Menu, Popover } from '@ui';",
  exports: ['Popover', 'Menu'],
  propTypes: ['PopoverContentProps'],
  demos: [
    {
      id: 'menu-popover',
      title: 'Shared menu surface and items',
      description:
        'Keep width and placement on the caller. Surface material, row padding, radius, and interaction states stay in the shared primitives.',
      render: MenuPopoverDemo,
    },
  ],
});
