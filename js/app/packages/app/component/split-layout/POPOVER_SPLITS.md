# Popover Splits

This document describes the new popover split feature, which allows you to render blocks or registered components in temporary modal dialogs that are properly scoped to the split layout.

## Overview

Popover splits provide a way to display content in a modal dialog without creating a permanent split. They are perfect for:

- Quick actions (compose, search, etc.)
- Temporary content viewing
- Modal forms and dialogs
- Context-specific overlays

## Basic Usage

### Using the Hook

The easiest way to use popover splits is through the `useSplitPopovers` hook:

```tsx
import { useSplitPopovers } from '@app/component/split-layout/popover';

function MyComponent() {
  const popovers = useSplitPopovers();
  
  const openQuickCreate = () => {
    const handle = popovers.createComponentPopover(
      'channel-compose',
      { /* component params */ },
      {
        style: {
          maxWidth: '600px',
          position: 'center',
          className: 'shadow-lg rounded-lg',
        },
        onClose: () => console.log('Closed!'),
      }
    );
  };
  
  return (
    <button onClick={openQuickCreate}>
      Quick Create
    </button>
  );
}
```

### Direct SplitManager Access

You can also use popover splits directly through the split manager:

```tsx
import { useContext } from 'solid-js';
import { SplitLayoutContext } from '@app/component/split-layout/context';

function MyComponent() {
  const { manager } = useContext(SplitLayoutContext);
  
  const openPopover = () => {
    const handle = manager.createPopoverSplit({
      content: {
        type: 'component',
        id: 'unified-list',
        params: { viewId: 'signal' },
      },
      style: {
        maxWidth: '800px',
        maxHeight: '600px',
        position: 'center',
      },
      onClose: () => console.log('Popover closed'),
    });
  };
  
  return <button onClick={openPopover}>Open Popover</button>;
}
```

## API Reference

### PopoverSplitOptions

```typescript
type PopoverSplitOptions = {
  content: SplitContent;
  style?: {
    maxWidth?: string;
    maxHeight?: string;
    position?: 'center' | 'top' | 'bottom' | 'left' | 'right';
    className?: string;
  };
  onClose?: () => void;
};
```

- `content`: The split content to render (block or component)
- `style.maxWidth`: Maximum width of the popover (default: '600px')
- `style.maxHeight`: Maximum height of the popover (default: '80vh')
- `style.position`: Position of the popover on screen (default: 'center')
- `style.className`: Additional CSS classes to apply
- `onClose`: Callback function called when the popover closes

### PopoverSplitHandle

```typescript
type PopoverSplitHandle = {
  close: () => void;
  isOpen: () => boolean;
  content: () => SplitContent;
  id: string;
};
```

- `close()`: Programmatically close the popover
- `isOpen()`: Check if the popover is currently open
- `content()`: Get the current content of the popover
- `id`: Unique identifier for the popover

### useSplitPopovers Hook

The hook provides several convenience methods:

```typescript
const popovers = useSplitPopovers();

// Create a component popover
popovers.createComponentPopover(
  componentId: string,
  params?: Record<string, any>,
  options?: Partial<PopoverSplitOptions>
): PopoverSplitHandle

// Create a block popover
popovers.createBlockPopover(
  blockType: string,
  blockId: string,
  options?: Partial<PopoverSplitOptions>
): PopoverSplitHandle

// Create a custom popover
popovers.createPopover(options: PopoverSplitOptions): PopoverSplitHandle

// Get all active popovers
popovers.getActivePopovers(): PopoverSplitHandle[]

// Close all popovers
popovers.closeAllPopovers(): void
```

## Examples

### Quick Action Menu

```tsx
function QuickActionMenu() {
  const popovers = useSplitPopovers();
  
  return (
    <div class="flex gap-2">
      <IconButton
        icon={PlusIcon}
        tooltip={{ label: 'Quick Create' }}
        onClick={() => {
          popovers.createComponentPopover('channel-compose', {}, {
            style: { maxWidth: '500px', position: 'center' }
          });
        }}
      />
      <IconButton
        icon={SearchIcon}
        tooltip={{ label: 'Search' }}
        onClick={() => {
          popovers.createComponentPopover('unified-list', { viewId: 'search' }, {
            style: { maxWidth: '800px', position: 'top' }
          });
        }}
      />
    </div>
  );
}
```

### Custom Styled Popover

```tsx
function CustomPopoverExample() {
  const popovers = useSplitPopovers();
  
  const openCustomPopover = () => {
    popovers.createComponentPopover('loading', {}, {
      style: {
        maxWidth: '400px',
        position: 'bottom',
        className: 'bg-gradient-to-r from-blue-500 to-purple-600 text-white p-6 rounded-xl shadow-2xl',
      },
      onClose: () => console.log('Custom popover closed'),
    });
  };
  
  return <button onClick={openCustomPopover}>Open Custom Popover</button>;
}
```

### Programmatic Control

```tsx
function ControlledPopover() {
  const popovers = useSplitPopovers();
  const [currentPopover, setCurrentPopover] = createSignal<PopoverSplitHandle | null>(null);
  
  const openPopover = () => {
    const handle = popovers.createComponentPopover('unified-list', {}, {
      onClose: () => setCurrentPopover(null),
    });
    setCurrentPopover(handle);
  };
  
  const closePopover = () => {
    const handle = currentPopover();
    if (handle) {
      handle.close();
      setCurrentPopover(null);
    }
  };
  
  return (
    <div>
      <button onClick={openPopover} disabled={!!currentPopover()}>
        Open Popover
      </button>
      <button onClick={closePopover} disabled={!currentPopover()}>
        Close Popover
      </button>
      <button onClick={() => popovers.closeAllPopovers()}>
        Close All Popovers
      </button>
    </div>
  );
}
```

## Styling

Popover splits use the existing `SplitModal` component internally and support all the same styling patterns. You can customize the appearance using:

1. **CSS Classes**: Pass custom classes via the `className` option
2. **Positioning**: Use the `position` option to control placement
3. **Sizing**: Set `maxWidth` and `maxHeight` for size constraints

### Position Options

- `center`: Centered on screen (default)
- `top`: Top of the screen with padding
- `bottom`: Bottom of the screen with padding
- `left`: Left side of the screen with padding
- `right`: Right side of the screen with padding

## Integration with Existing Features

Popover splits integrate seamlessly with the existing split layout system:

- **Component Registry**: Use any registered component
- **Block System**: Mount any block type
- **Split Context**: Access split context and utilities
- **Focus Management**: Proper focus handling and restoration
- **Cleanup**: Automatic cleanup when closed

## Performance Considerations

- Popovers are automatically cleaned up after closing (with a 300ms delay for animations)
- Multiple popovers can be open simultaneously with proper z-index stacking
- Components are properly mounted/unmounted following the same lifecycle as regular splits

## Migration Notes

This feature is fully additive and doesn't break any existing functionality. You can start using popover splits alongside your existing split management without any changes to current code.