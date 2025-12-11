import { useContext } from 'solid-js';
import { SplitPanelContext } from '../context';
import { useSplitPopovers } from '../hooks/useSplitPopovers';

/**
 * Test component to verify that SplitPanelContext is properly provided in popovers
 */
export function PopoverContextTest() {
  const popovers = useSplitPopovers();

  const openContextTest = () => {
    popovers.createPopover({
      content: { type: 'component', id: 'context-test-component' },
      style: {
        maxWidth: '600px',
        position: 'center',
        className: 'bg-menu border border-edge p-4 rounded-lg',
      },
      onClose: () => console.log('Context test popover closed'),
    });
  };

  return (
    <div class="p-4">
      <h2 class="text-xl font-bold mb-4">Popover Context Test</h2>
      <button
        class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        onClick={openContextTest}
      >
        Open Context Test Popover
      </button>
    </div>
  );
}

/**
 * Component that tests the SplitPanelContext
 */
export function ContextTestComponent() {
  const context = useContext(SplitPanelContext);

  if (!context) {
    return (
      <div class="p-4 bg-red-100 border border-red-300 rounded">
        <h3 class="text-red-800 font-bold">❌ Context Missing</h3>
        <p class="text-red-700">SplitPanelContext is not available!</p>
      </div>
    );
  }

  const { handle, splitHotkeyScope, isPanelActive, panelRef } = context;

  return (
    <div class="p-6 space-y-4">
      <div class="bg-green-100 border border-green-300 rounded p-3">
        <h3 class="text-green-800 font-bold mb-2">✅ Context Available</h3>
        <p class="text-green-700">SplitPanelContext is working correctly!</p>
      </div>

      <div class="space-y-3">
        <h4 class="font-semibold">Context Properties:</h4>

        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <strong>Handle ID:</strong> {handle.id}
          </div>
          <div>
            <strong>Content Type:</strong> {handle.content().type}
          </div>
          <div>
            <strong>Content ID:</strong> {handle.content().id}
          </div>
          <div>
            <strong>Is Active:</strong> {handle.isActive() ? 'Yes' : 'No'}
          </div>
          <div>
            <strong>Display Name:</strong> {handle.displayName()}
          </div>
          <div>
            <strong>Hotkey Scope:</strong> {splitHotkeyScope}
          </div>
          <div>
            <strong>Panel Active:</strong> {isPanelActive() ? 'Yes' : 'No'}
          </div>
          <div>
            <strong>Panel Ref:</strong> {panelRef() ? 'Available' : 'Null'}
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <h4 class="font-semibold">Handle Methods Test:</h4>
        <div class="flex gap-2 flex-wrap">
          <button
            class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 text-sm"
            onClick={() => {
              console.log('Can go back:', handle.canGoBack());
              console.log('Can go forward:', handle.canGoForward());
            }}
          >
            Test Navigation
          </button>
          <button
            class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 text-sm"
            onClick={() => {
              console.log('URL Segments:', handle.getUrlSegments());
              console.log('URL:', handle.getUrl());
            }}
          >
            Test URL Methods
          </button>
          <button
            class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 text-sm"
            onClick={() => {
              console.log('Spotlight state:', handle.isSpotLight());
              handle.toggleSpotlight();
            }}
          >
            Test Spotlight
          </button>
          <button
            class="px-3 py-1 bg-red-200 rounded hover:bg-red-300 text-sm"
            onClick={() => handle.close()}
          >
            Close Popover
          </button>
        </div>
      </div>

      <div class="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
        <p class="text-blue-800 text-sm">
          <strong>Success!</strong> This component is running inside a popover
          with full SplitPanelContext support. Components and blocks should work
          normally within popovers.
        </p>
      </div>
    </div>
  );
}
