import { IconButton } from '@core/component/IconButton';
import ChatIcon from '@icon/regular/chat.svg';
import SettingsIcon from '@icon/regular/gear.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import PlusIcon from '@icon/regular/plus.svg';
import { createSignal, Show } from 'solid-js';
import { useSplitPopovers } from '../hooks/useSplitPopovers';
import type { PopoverSplitHandle } from '../layoutManager';

/**
 * Demo component showcasing the new popover split feature
 * This demonstrates various use cases and styling options
 */
export function PopoverDemo() {
  const popovers = useSplitPopovers();
  const [currentPopover, setCurrentPopover] =
    createSignal<PopoverSplitHandle | null>(null);
  const [demoStats, setDemoStats] = createSignal({
    totalOpened: 0,
    currentlyOpen: 0,
  });

  const updateStats = () => {
    const activeCount = popovers.getActivePopovers().length;
    setDemoStats((prev) => ({
      totalOpened: prev.totalOpened + 1,
      currentlyOpen: activeCount,
    }));
  };

  // Demo 1: Quick Create Component
  const openQuickCreate = () => {
    const handle = popovers.createComponentPopover(
      'channel-compose',
      {},
      {
        style: {
          maxWidth: '600px',
          maxHeight: '500px',
          position: 'center',
          className: 'bg-menu border border-accent rounded-lg shadow-2xl',
        },
        onClose: () => {
          console.log('Quick create popover closed');
          setCurrentPopover(null);
        },
      }
    );
    setCurrentPopover(handle);
    updateStats();
  };

  // Demo 2: Search Interface
  const openSearch = () => {
    popovers.createComponentPopover(
      'unified-list',
      { viewId: 'signal' },
      {
        style: {
          maxWidth: '800px',
          maxHeight: '600px',
          position: 'top',
          className: 'mt-4 bg-menu border border-edge rounded-md shadow-lg',
        },
        onClose: () => {
          console.log('Search popover closed');
        },
      }
    );
    updateStats();
  };

  // Demo 3: Loading Component with Custom Styling
  const openCustomStyled = () => {
    popovers.createComponentPopover(
      'loading',
      {},
      {
        style: {
          maxWidth: '400px',
          maxHeight: '300px',
          position: 'bottom',
          className:
            'mb-8 bg-gradient-to-r from-blue-500 to-purple-600 text-white p-8 rounded-xl shadow-2xl border-2 border-white/20',
        },
        onClose: () => {
          console.log('Custom styled popover closed');
        },
      }
    );
    updateStats();
  };

  // Demo 4: Multiple Popover Management
  const openMultiplePopovers = () => {
    // Open three different popovers
    popovers.createComponentPopover(
      'loading',
      {},
      {
        style: { maxWidth: '300px', position: 'left', className: 'ml-4' },
      }
    );

    popovers.createComponentPopover(
      'channel-compose',
      {},
      {
        style: { maxWidth: '400px', position: 'center' },
      }
    );

    popovers.createComponentPopover(
      'unified-list',
      { viewId: 'signal' },
      {
        style: { maxWidth: '300px', position: 'right', className: 'mr-4' },
      }
    );

    setDemoStats((prev) => ({ ...prev, totalOpened: prev.totalOpened + 3 }));
  };

  // Demo 5: Email Compose
  const openEmailCompose = () => {
    popovers.createComponentPopover(
      'email-compose',
      {},
      {
        style: {
          maxWidth: '700px',
          maxHeight: '600px',
          position: 'center',
          className: 'bg-menu border-2 border-edge rounded-lg shadow-xl',
        },
        onClose: () => {
          console.log('Email compose closed');
        },
      }
    );
    updateStats();
  };

  const closeCurrentPopover = () => {
    const handle = currentPopover();
    if (handle && handle.isOpen()) {
      handle.close();
      setCurrentPopover(null);
    }
  };

  const closeAllPopovers = () => {
    popovers.closeAllPopovers();
    setCurrentPopover(null);
    setDemoStats((prev) => ({ ...prev, currentlyOpen: 0 }));
  };

  return (
    <div class="p-6 max-w-4xl mx-auto">
      <div class="mb-8">
        <h1 class="text-3xl font-bold mb-2">Popover Splits Demo</h1>
        <p class="text-gray-600 mb-4">
          Showcase of the new temporary popover split feature. Click the buttons
          below to see different popover configurations.
        </p>

        {/* Stats Display */}
        <div class="flex gap-4 p-4 bg-gray-100 rounded-lg mb-6">
          <div class="text-sm">
            <span class="font-semibold">Total Opened:</span>{' '}
            {demoStats().totalOpened}
          </div>
          <div class="text-sm">
            <span class="font-semibold">Currently Open:</span>{' '}
            {popovers.getActivePopovers().length}
          </div>
        </div>
      </div>

      {/* Demo Controls Grid */}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {/* Basic Examples */}
        <div class="bg-white p-4 rounded-lg border border-gray-200">
          <h3 class="font-semibold mb-3 flex items-center gap-2">
            <PlusIcon class="w-4 h-4" />
            Quick Actions
          </h3>
          <div class="space-y-2">
            <button
              class="w-full px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
              onClick={openQuickCreate}
            >
              Quick Create
            </button>
            <button
              class="w-full px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
              onClick={openSearch}
            >
              Open Search
            </button>
            <button
              class="w-full px-3 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors"
              onClick={openEmailCompose}
            >
              Email Compose
            </button>
          </div>
        </div>

        {/* Styling Examples */}
        <div class="bg-white p-4 rounded-lg border border-gray-200">
          <h3 class="font-semibold mb-3 flex items-center gap-2">
            <SettingsIcon class="w-4 h-4" />
            Custom Styling
          </h3>
          <div class="space-y-2">
            <button
              class="w-full px-3 py-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded hover:from-pink-600 hover:to-purple-600 transition-all"
              onClick={openCustomStyled}
            >
              Gradient Popover
            </button>
            <button
              class="w-full px-3 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-600 transition-colors"
              onClick={openMultiplePopovers}
            >
              Multiple Popovers
            </button>
          </div>
        </div>

        {/* Control Examples */}
        <div class="bg-white p-4 rounded-lg border border-gray-200">
          <h3 class="font-semibold mb-3 flex items-center gap-2">
            <ChatIcon class="w-4 h-4" />
            Controls
          </h3>
          <div class="space-y-2">
            <button
              class="w-full px-3 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={closeCurrentPopover}
              disabled={!currentPopover() || !currentPopover()?.isOpen()}
            >
              Close Current
            </button>
            <button
              class="w-full px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              onClick={closeAllPopovers}
            >
              Close All
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar Example */}
      <div class="bg-gray-50 p-4 rounded-lg mb-8">
        <h3 class="font-semibold mb-3">Toolbar Integration Example</h3>
        <div class="flex gap-2">
          <IconButton
            icon={PlusIcon}
            tooltip={{ label: 'Quick Create Channel' }}
            onClick={() => {
              popovers.createComponentPopover(
                'channel-compose',
                {},
                {
                  style: { maxWidth: '500px', position: 'center' },
                }
              );
              updateStats();
            }}
          />
          <IconButton
            icon={SearchIcon}
            tooltip={{ label: 'Quick Search' }}
            onClick={() => {
              popovers.createComponentPopover(
                'unified-list',
                { viewId: 'search' },
                {
                  style: { maxWidth: '700px', position: 'top' },
                }
              );
              updateStats();
            }}
          />
          <IconButton
            icon={ChatIcon}
            tooltip={{ label: 'Quick Chat' }}
            onClick={() => {
              popovers.createComponentPopover(
                'loading',
                {},
                {
                  style: {
                    maxWidth: '400px',
                    position: 'center',
                    className:
                      'bg-chat-bg border-2 border-chat-accent rounded-lg',
                  },
                }
              );
              updateStats();
            }}
          />
        </div>
      </div>

      {/* Code Example */}
      <div class="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto">
        <h3 class="text-white font-semibold mb-3">Code Example</h3>
        <pre class="text-sm">
          {`// Basic usage
const popovers = useSplitPopovers();

// Open a component popover
const handle = popovers.createComponentPopover(
  'channel-compose',
  { /* params */ },
  {
    style: {
      maxWidth: '600px',
      position: 'center',
      className: 'custom-class'
    },
    onClose: () => console.log('Closed!')
  }
);

// Close programmatically
handle.close();

// Close all popovers
popovers.closeAllPopovers();`}
        </pre>
      </div>

      {/* Status Information */}
      <Show when={popovers.getActivePopovers().length > 0}>
        <div class="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 class="font-semibold text-blue-800 mb-2">Active Popovers:</h4>
          <ul class="text-sm text-blue-700">
            {popovers.getActivePopovers().map((popover) => (
              <li>
                •{' '}
                {popover.content().type === 'component'
                  ? `Component: ${popover.content().id}`
                  : `Block: ${popover.content().type}`}{' '}
                (ID: {popover.id.slice(-8)})
              </li>
            ))}
          </ul>
        </div>
      </Show>
    </div>
  );
}

/**
 * Minimal example for documentation
 */
export function PopoverMinimalExample() {
  const popovers = useSplitPopovers();

  return (
    <button
      onClick={() => {
        popovers.createComponentPopover(
          'unified-list',
          {},
          {
            style: { maxWidth: '600px' },
            onClose: () => console.log('Popover closed'),
          }
        );
      }}
    >
      Open Popover
    </button>
  );
}
