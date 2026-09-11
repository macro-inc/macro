import { defineDoc } from '@app/features/ui-gallery/types';
import ArrowCounterClockwiseIcon from '@phosphor/arrow-counter-clockwise.svg';
import CopyIcon from '@phosphor/copy.svg';
import LinkIcon from '@phosphor/link.svg';
import ZoomOutIcon from '@phosphor/magnifying-glass-minus.svg';
import ZoomInIcon from '@phosphor/magnifying-glass-plus.svg';
import TrashIcon from '@phosphor/trash.svg';
import { createSignal } from 'solid-js';
import { Toolbar } from './Toolbar';

// #region demo:basic
function BasicDemo() {
  return (
    <Toolbar size="icon-sm">
      <Toolbar.Group>
        <Toolbar.Button label="Undo">
          <ArrowCounterClockwiseIcon />
        </Toolbar.Button>
      </Toolbar.Group>
      <Toolbar.Divider />
      <Toolbar.Group>
        <Toolbar.Button label="Copy">
          <CopyIcon />
        </Toolbar.Button>
        <Toolbar.Button label="Copy link">
          <LinkIcon />
        </Toolbar.Button>
      </Toolbar.Group>
      <Toolbar.Divider />
      <Toolbar.Button label="Delete" class="text-failure-ink">
        <TrashIcon />
      </Toolbar.Button>
    </Toolbar>
  );
}
// #endregion

// #region demo:medium
function MediumDemo() {
  const [zoom, setZoom] = createSignal(100);

  return (
    <Toolbar size="md">
      <Toolbar.Button onClick={() => setZoom(100)}>
        Fit to screen
      </Toolbar.Button>
      <Toolbar.Divider />
      <Toolbar.Group>
        <Toolbar.Button
          size="icon-md"
          label="Zoom out"
          onClick={() => setZoom((value) => Math.max(25, value - 25))}
        >
          <ZoomOutIcon />
        </Toolbar.Button>
        <Toolbar.Button class="w-14 tabular-nums" onClick={() => setZoom(100)}>
          {zoom()}%
        </Toolbar.Button>
        <Toolbar.Button
          size="icon-md"
          label="Zoom in"
          onClick={() => setZoom((value) => Math.min(200, value + 25))}
        >
          <ZoomInIcon />
        </Toolbar.Button>
      </Toolbar.Group>
    </Toolbar>
  );
}
// #endregion

export default defineDoc({
  name: 'Toolbar',
  category: 'Actions',
  description:
    'A floating surface for compact actions. It owns the frame and shares button size and variant defaults with its children.',
  status: 'stable',
  exports: ['Toolbar'],
  import: "import { Toolbar } from '@ui';",
  demos: [
    {
      id: 'basic',
      title: 'Basic',
      description:
        'Group related buttons and separate distinct action sets with `Toolbar.Divider`.',
      render: BasicDemo,
    },
    {
      id: 'medium',
      title: 'Medium with text',
      description:
        'The `md` size supports text actions and compact widgets alongside icon controls.',
      render: MediumDemo,
    },
  ],
});
