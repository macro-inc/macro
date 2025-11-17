# Unified Entity Actions Implementation Guide

This guide explains the new unified action pattern for handling operations on single entities or multiple selected entities in the UnifiedListView and SoupContext components.

## Overview

The unified action system eliminates the duplication between single entity and bulk entity action handlers by providing a "bulkifier" pattern that automatically handles both cases through a single interface. The system is designed to **wrap your existing SoupContext** rather than replace it entirely.

## Key Components

### 1. UnifiedEntityActions.tsx
The core system that provides:
- `createEntityActionRegistry()`: Factory function for action registries
- `createBulkifiedAction()`: Wraps single entity handlers to work with arrays
- `createEntityActionManager()`: Manages selection state and action execution
- Type definitions for actions and results

### 2. SoupContextWithActions.tsx
The main integration layer that:
- `wrapSoupContextWithActions()`: Enhances existing SoupContext with action capabilities
- `registerCommonActions()`: Helper to register your existing action handlers
- `useEntityActions()`: Hook providing action utilities for components
- No need to rewrite your existing context - just wrap it!

## Implementation Pattern

### Wrapping Your Existing Context

The key is using `wrapSoupContextWithActions()` to enhance your existing context:

```tsx
// Your existing context creation
const originalContext = createSoupContext();

// Wrap it with action capabilities
const contextWithActions = wrapSoupContextWithActions(
  originalContext,
  () => emailView() // your email view accessor
);

// Register your existing handlers
registerCommonActions(contextWithActions, {
  markAsDone: async (entity: EntityData) => {
    // Your existing markEntityAsDone logic here
    if (entity.type === 'email') {
      await archiveEmail(entity.id, { isDone: entity.done });
    }
    markNotificationsForEntityAsDone(notificationSource, entity);
    return { success: true };
  },
  delete: async (entity: EntityData) => {
    // Your existing delete logic - could open modal
    openBulkEditEntityModal({ view: 'delete', entities: () => [entity] });
    return { success: true };
  },
  // ... other handlers
});
```

### Using Enhanced Context

```tsx
// Your enhanced context has all original properties PLUS:
const {
  // Original context properties
  viewsDataStore,
  setViewDataStore,
  selectedView,
  setSelectedView,
  // ... all other original properties

  // New action capabilities
  executeAction,
  isActionAvailable,
  selectedEntities,
  handleEntityClick,
  clearSelection,
} = contextWithActions;

// Execute actions uniformly
await executeAction('mark_as_done', singleEntity);
await executeAction('mark_as_done', [entity1, entity2, entity3]);
await executeAction('mark_as_done'); // Uses current selection
```

## Integration Steps

### Step 1: Wrap Your Existing Context

No need to replace anything - just wrap your existing context:

```tsx
// Before
const unifiedListContext = createSoupContext();

// After
const originalContext = createSoupContext();
const unifiedListContext = wrapSoupContextWithActions(
  originalContext,
  () => emailView()
);
```

### Step 2: Register Your Existing Handlers

Use the helper function to register your current logic:

```tsx
registerCommonActions(unifiedListContext, {
  markAsDone: (entity) => {
    // Your existing markEntityAsDone logic
    return { success: true };
  },
  delete: (entity) => {
    // Your existing delete logic
    return { success: true };
  },
  // ... other handlers
});
```

### Step 3: Update Components Gradually

Use the enhanced context with backward compatibility:

```tsx
// Your existing components still work, but now you can also use:

// Unified action execution
const handleAction = (entity: EntityData) => 
  unifiedListContext.executeAction('mark_as_done', entity);

// Enhanced disabled state calculation
const disabledActions = unifiedListContext.getActionDisabledState();

// Enhanced entity clicks with selection
const handleEntityClick = (entity: EntityData, event: MouseEvent) => 
  unifiedListContext.handleEntityClick(entity, event);
```

### Step 4: Use Action Utilities

Get helpful utilities for your components:

```tsx
const entityActions = useEntityActions(unifiedListContext);

// Check capabilities
if (entityActions.canExecuteAction('mark_as_done', entity)) {
  // Show action button
}

// Execute on selection
await entityActions.executeOnSelected('delete');

// Get context menu actions
const menuActions = entityActions.getContextMenuActions(entity);
```

## Migration Strategy

### Phase 1: Wrap Without Breaking Changes
- Wrap your existing context with `wrapSoupContextWithActions()`
- Register your existing handlers with `registerCommonActions()`
- Everything continues to work exactly as before
- No component changes required initially

### Phase 2: Gradual Enhancement
Use the legacy compatibility helper:

```tsx
const legacyHandlers = createLegacyCompatibleHandlers(contextWithActions);

// These match your existing signatures
const markEntityAsDone = legacyHandlers.markEntityAsDone;
const onClickRowAction = legacyHandlers.onClickRowAction;
const disabledActions = legacyHandlers.disabledActions;

// But now they work with the unified system under the hood
```

### Phase 3: Component Migration
- Gradually update components to use `contextWithActions.executeAction()`
- Replace disabled state logic with `getActionDisabledState()`
- Add selection capabilities with `handleEntityClick()`
- Remove duplicate bulk/single action handlers

### Phase 4: Cleanup
- Remove legacy compatibility layer
- Clean up duplicate code
- Enjoy simplified action handling!

## Benefits

1. **Zero Breaking Changes**: Wraps existing context without requiring rewrites
2. **Reduced Duplication**: Single action handlers work for both individual and bulk operations
3. **Consistent Behavior**: Same logic applies whether operating on one item or many
4. **Type Safety**: Strong typing for actions, results, and entity types
5. **Easier Testing**: Test single entity logic, bulk behavior is automatic
6. **Better Error Handling**: Centralized error handling and result reporting
7. **Flexible Selection**: Supports both single-select and multi-select modes
8. **Gradual Migration**: Adopt new features incrementally at your own pace

## Action Result Handling

Actions return standardized results:

```tsx
type EntityActionResult = {
  success: boolean;
  failedEntities?: EntityData[];
  message?: string;
};
```

This enables consistent error handling and user feedback across all operations.

## Advanced Features

### Custom Bulk Handlers
For actions that need special bulk optimization:

```tsx
contextWithActions.actionRegistry.registerBulk(
  'delete',
  singleDeleteHandler,
  async (entities: EntityData[]) => {
    // Optimized bulk delete API call
    return await bulkDeleteAPI(entities.map(e => e.id));
  }
);
```

### Conditional Actions
Actions can be conditionally available:

```tsx
contextWithActions.actionRegistry.register('archive', archiveHandler, {
  label: 'Archive',
  disabled: (entity) => entity.type !== 'email',
  bulkDisabled: (entities) => entities.some(e => e.type !== 'email'),
});
```

### Integration with Existing Modals
Actions can delegate to existing modal systems:

```tsx
registerCommonActions(contextWithActions, {
  delete: async (entity: EntityData) => {
    // Open your existing bulk edit modal for single entity
    openBulkEditEntityModal({ 
      view: 'delete', 
      entities: () => [entity] 
    });
    return { success: true, message: 'Delete modal opened' };
  }
});
```

## Testing Strategy

Test single entity handlers - bulk behavior is automatically tested:

```tsx
describe('Unified Actions', () => {
  const originalContext = createSoupContext();
  const contextWithActions = wrapSoupContextWithActions(originalContext, () => 'inbox');
  
  beforeEach(() => {
    registerCommonActions(contextWithActions, {
      markAsDone: mockMarkAsDoneHandler,
    });
  });

  it('should handle single entity', async () => {
    const result = await contextWithActions.executeAction('mark_as_done', mockEntity);
    expect(result.success).toBe(true);
  });

  it('should handle bulk entities automatically', async () => {
    const result = await contextWithActions.executeAction('mark_as_done', mockEntities);
    expect(result.success).toBe(true);
  });
});
```

## Performance Considerations

- Actions are executed sequentially for safety
- Failed entities are tracked and reported
- Selection state is optimized for large lists
- Modal integration prevents UI blocking

## Quick Start Example

Here's the minimal code to get started:

```tsx
// 1. Wrap your existing context
const originalContext = createSoupContext();
const contextWithActions = wrapSoupContextWithActions(originalContext, () => emailView());

// 2. Register your existing handlers
registerCommonActions(contextWithActions, {
  markAsDone: (entity) => { /* your existing logic */ return { success: true }; },
  delete: (entity) => { /* your existing logic */ return { success: true }; },
});

// 3. Use enhanced context in components
const { executeAction, isActionAvailable, handleEntityClick } = contextWithActions;

// 4. Execute actions uniformly
await executeAction('mark_as_done', entity); // single
await executeAction('mark_as_done', entities); // bulk
await executeAction('mark_as_done'); // current selection
```

This unified system provides a clean, maintainable approach to entity actions that scales from individual operations to bulk processing while maintaining complete backward compatibility with existing code. **No rewrites required!**