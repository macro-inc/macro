import { IconButton } from '@core/component/IconButton';
import PlusIcon from '@icon/regular/plus.svg';
import { createSignal } from 'solid-js';
import { useSplitPopovers } from '../hooks/useSplitPopovers';

/**
 * Example component demonstrating how to use popover splits
 */
export function PopoverSplitUsageExample() {
  const popovers = useSplitPopovers();
  const [popoverHandle, setPopoverHandle] = createSignal<any>(null);

  // Example 1: Create a component popover
  const openComponentPopover = () => {
    const handle = popovers.createComponentPopover(
      'unified-list',
      { viewId: 'signal' },
      {
        style: {
          maxWidth: '800px',
          maxHeight: '600px',
          position: 'center',
          className: 'rounded-lg shadow-xl',
        },
        onClose: () => {
          console.log('Component popover closed');
          setPopoverHandle(null);
        },
      }
    );
    setPopoverHandle(handle);
  };

  // Example 2: Create a block popover
  const openBlockPopover = () => {
    const handle = popovers.createBlockPopover(
      'some-block-name',
      'unique-block-id',
      {
        style: {
          maxWidth: '600px',
          position: 'top',
          className: 'bg-menu border-2 border-accent rounded-md p-4',
        },
        onClose: () => {
          console.log('Block popover closed');
          setPopoverHandle(null);
        },
      }
    );
    setPopoverHandle(handle);
  };

  // Example 3: Create a custom styled popover
  const openCustomPopover = () => {
    const handle = popovers.createPopover({
      content: {
        type: 'component',
        id: 'loading',
        params: {},
      },
      style: {
        maxWidth: '400px',
        maxHeight: '300px',
        position: 'bottom',
        className:
          'bg-gradient-to-r from-blue-500 to-purple-600 text-white p-6 rounded-xl shadow-2xl',
      },
      onClose: () => {
        console.log('Custom popover closed');
        setPopoverHandle(null);
      },
    });
    setPopoverHandle(handle);
  };

  // Example 4: Programmatically close popover
  const closeCurrentPopover = () => {
    const handle = popoverHandle();
    if (handle) {
      handle.close();
      setPopoverHandle(null);
    }
  };

  // Example 5: Close all popovers
  const closeAllPopovers = () => {
    popovers.closeAllPopovers();
    setPopoverHandle(null);
  };

  return (
    <div class="p-4 space-y-4">
      <h2 class="text-xl font-bold mb-4">Popover Split Examples</h2>

      <div class="grid grid-cols-2 gap-4">
        <div class="space-y-2">
          <h3 class="font-semibold">Basic Examples</h3>

          <button class="btn btn-primary w-full" onClick={openComponentPopover}>
            Open Component Popover
          </button>

          <button class="btn btn-secondary w-full" onClick={openBlockPopover}>
            Open Block Popover
          </button>

          <button class="btn btn-accent w-full" onClick={openCustomPopover}>
            Open Custom Styled Popover
          </button>
        </div>

        <div class="space-y-2">
          <h3 class="font-semibold">Control Examples</h3>

          <button
            class="btn btn-warning w-full"
            onClick={closeCurrentPopover}
            disabled={!popoverHandle()}
          >
            Close Current Popover
          </button>

          <button class="btn btn-error w-full" onClick={closeAllPopovers}>
            Close All Popovers
          </button>

          <div class="text-sm text-gray-600 mt-2">
            Status: {popoverHandle() ? 'Popover Open' : 'No Active Popover'}
          </div>
        </div>
      </div>

      <div class="mt-8">
        <h3 class="font-semibold mb-2">Usage in Action Button</h3>
        <IconButton
          icon={PlusIcon}
          tooltip={{ label: 'Quick Create' }}
          onClick={() => {
            popovers.createComponentPopover(
              'channel-compose',
              {},
              {
                style: {
                  maxWidth: '500px',
                  position: 'center',
                },
                onClose: () => console.log('Quick create closed'),
              }
            );
          }}
        />
      </div>

      <div class="mt-8 p-4 bg-gray-100 rounded">
        <h3 class="font-semibold mb-2">Code Examples</h3>
        <pre class="text-sm text-gray-700">
          {`// Basic component popover
const handle = popovers.createComponentPopover(
  'unified-list',
  { viewId: 'signal' },
  {
    style: {
      maxWidth: '800px',
      position: 'center',
    },
    onClose: () => console.log('Closed!'),
  }
);

// Custom popover with full control
const customHandle = popovers.createPopover({
  content: { type: 'component', id: 'loading' },
  style: {
    className: 'my-custom-class',
    maxWidth: '600px',
  },
});

// Close programmatically
customHandle.close();`}
        </pre>
      </div>
    </div>
  );
}

/**
 * Real-world example: Quick Action Menu
 */
export function QuickActionMenu() {
  const popovers = useSplitPopovers();

  const openQuickCreate = () => {
    popovers.createComponentPopover(
      'channel-compose',
      {},
      {
        style: {
          maxWidth: '600px',
          maxHeight: '400px',
          position: 'center',
          className: 'shadow-lg border-2 border-accent rounded-lg',
        },
        onClose: () => console.log('Quick create menu closed'),
      }
    );
  };

  const openSearch = () => {
    popovers.createComponentPopover(
      'unified-list',
      { viewId: 'search' },
      {
        style: {
          maxWidth: '800px',
          maxHeight: '600px',
          position: 'top',
          className: 'mt-4',
        },
      }
    );
  };

  return (
    <div class="flex gap-2">
      <IconButton
        icon={PlusIcon}
        tooltip={{ label: 'Quick Create' }}
        onClick={openQuickCreate}
      />
      <IconButton
        icon={PlusIcon}
        tooltip={{ label: 'Quick Search' }}
        onClick={openSearch}
      />
    </div>
  );
}
