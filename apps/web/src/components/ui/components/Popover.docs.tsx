import { defineDoc } from '@app/features/ui-gallery/types';
import { Button } from './Button';
import { Input } from './Input';
import { Popover } from './Popover';

// #region demo:basic
function BasicDemo() {
  return (
    <Popover>
      <Popover.Trigger as={Button} variant="secondary">
        More options
      </Popover.Trigger>
      <Popover.Content class="w-64">
        <Popover.Title class="font-medium">Options</Popover.Title>
        <Popover.Description class="mt-1 text-ink-muted">
          Adjust the settings for this field.
        </Popover.Description>
        <Input aria-label="Name" placeholder="Name" class="mt-3" />
        <Popover.Close
          as={Button}
          variant="secondary"
          size="sm"
          class="mt-3"
          aria-label="Done"
        >
          Done
        </Popover.Close>
      </Popover.Content>
    </Popover>
  );
}
// #endregion

export default defineDoc({
  name: 'Popover',
  category: 'Overlays',
  description:
    'A click-open non-modal form overlay. Content owns the portal and surface; Title and Description name and describe the dialog.',
  status: 'stable',
  import: "import { Popover } from '@ui';",
  exports: ['Popover'],
  propTypes: ['PopoverRootProps', 'PopoverContentProps'],
  demos: [{ id: 'basic', title: 'Form options', render: BasicDemo }],
});
