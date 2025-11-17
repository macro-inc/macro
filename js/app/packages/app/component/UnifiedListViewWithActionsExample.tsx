import { MenuItem, MenuSeparator } from '@core/component/Menu';
import type { EntityData } from '@macro-entity';
import { createMemo, Show } from 'solid-js';
import { createSoupContext } from './SoupContext';
import {
  registerCommonActions,
  useEntityActions,
  wrapSoupContextWithActions,
} from './SoupContextWithActions';

/**
 * Example showing how to use the wrapSoupContextWithActions function
 */
export function UnifiedListViewWithActionsExample() {
  // Create the original context
  const originalContext = createSoupContext();

  // Wrap it with action capabilities
  const contextWithActions = wrapSoupContextWithActions(
    originalContext,
    () => 'inbox' // emailView accessor
  );

  // Register your existing action handlers
  registerCommonActions(contextWithActions, {
    markAsDone: async (entity: EntityData) => {
      // Your existing markEntityAsDone logic
      console.log('Marking as done:', entity.id);
      return { success: true };
    },
    delete: async (entity: EntityData) => {
      // Your existing delete logic - could open modal
      console.log('Deleting:', entity.id);
      return { success: true };
    },
    rename: async (entity: EntityData) => {
      // Your existing rename logic - could open modal
      console.log('Renaming:', entity.id);
      return { success: true };
    },
    moveToProject: async (entity: EntityData) => {
      // Your existing move to project logic
      console.log('Moving to project:', entity.id);
      return { success: true };
    },
  });

  // Use the enhanced context
  const entityActions = useEntityActions(contextWithActions);

  // Get current view and selected entity
  const view = createMemo(
    () => contextWithActions.viewsDataStore[contextWithActions.selectedView()]
  );
  const selectedEntity = createMemo(() => view()?.selectedEntity);

  return (
    <div class="unified-list-view">
      {/* Selection Toolbar - shows when entities are selected */}
      <Show when={entityActions.hasSelection()}>
        <div class="selection-toolbar">
          <span>{entityActions.selectedCount()} items selected</span>
          <button onClick={() => contextWithActions.clearSelection()}>
            Clear Selection
          </button>
          <button
            onClick={() => entityActions.executeOnSelected('mark_as_done')}
            disabled={!contextWithActions.isActionAvailable('mark_as_done')}
          >
            Mark All as Done
          </button>
          <button
            onClick={() => entityActions.executeOnSelected('delete')}
            disabled={!contextWithActions.isActionAvailable('delete')}
          >
            Delete All
          </button>
        </div>
      </Show>

      {/* Entity List */}
      <div class="entity-list">
        {/* Your existing entity list would go here */}
        <ExampleEntityItem
          entity={selectedEntity()}
          contextWithActions={contextWithActions}
          entityActions={entityActions}
        />
      </div>

      {/* Context Menu */}
      <Show when={selectedEntity()}>
        {(entity) => (
          <ContextMenuWithActions
            entity={entity()}
            contextWithActions={contextWithActions}
          />
        )}
      </Show>
    </div>
  );
}

/**
 * Example entity item showing integration with actions
 */
function ExampleEntityItem(props: {
  entity?: EntityData;
  contextWithActions: ReturnType<typeof wrapSoupContextWithActions>;
  entityActions: ReturnType<typeof useEntityActions>;
}) {
  if (!props.entity) return null;

  const entity = props.entity;
  const { contextWithActions, entityActions } = props;
  const isSelected = contextWithActions.isEntitySelected(entity);

  return (
    <div
      class={`entity-item ${isSelected ? 'selected' : ''}`}
      onClick={(event) => contextWithActions.handleEntityClick(entity, event)}
      data-entity-id={entity.id}
    >
      {/* Selection indicator */}
      <Show when={contextWithActions.isMultiSelectMode() || isSelected}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            if (e.target.checked) {
              contextWithActions.setSelectedEntities((prev) => [
                ...prev,
                entity,
              ]);
            } else {
              contextWithActions.setSelectedEntities((prev) =>
                prev.filter((e) => e.id !== entity.id)
              );
            }
          }}
        />
      </Show>

      {/* Entity content */}
      <div class="entity-content">
        <h3>{entity.name}</h3>
        <p>{entity.type}</p>
      </div>

      {/* Quick actions */}
      <div class="entity-actions">
        <Show
          when={contextWithActions.isActionAvailable('mark_as_done', entity)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              entityActions.executeOnEntity('mark_as_done', entity);
            }}
            class="action-button"
          >
            ✓
          </button>
        </Show>
      </div>
    </div>
  );
}

/**
 * Context menu using the unified actions
 */
function ContextMenuWithActions(props: {
  entity: EntityData;
  contextWithActions: ReturnType<typeof wrapSoupContextWithActions>;
}) {
  const { entity, contextWithActions } = props;
  const entityActions = useEntityActions(contextWithActions);

  // Get disabled states
  const disabledActions = createMemo(() =>
    contextWithActions.getActionDisabledState(entity)
  );

  // Get context menu actions
  const menuActions = entityActions.getContextMenuActions(entity);

  return (
    <div class="context-menu">
      {/* Single entity actions */}
      <MenuItem
        text="Mark as Done"
        onClick={() => contextWithActions.executeAction('mark_as_done', entity)}
        disabled={disabledActions().markAsDone}
      />

      <MenuSeparator />

      <MenuItem
        text="Delete"
        onClick={() => contextWithActions.executeAction('delete', entity)}
        disabled={disabledActions().delete}
      />

      <MenuItem
        text="Rename"
        onClick={() => contextWithActions.executeAction('rename', entity)}
        disabled={disabledActions().rename}
      />

      <MenuItem
        text="Move to Project"
        onClick={() =>
          contextWithActions.executeAction('move_to_project', entity)
        }
        disabled={disabledActions().moveToProject}
      />

      {/* Alternative: Use the helper-generated actions */}
      <MenuSeparator />
      <div class="helper-actions">
        {menuActions.map((action) => (
          <MenuItem
            text={action.label}
            onClick={action.onClick}
            disabled={action.disabled}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Migration example - wrapping existing UnifiedListView
 */
export function migrateExistingUnifiedListView(
  // Your existing props and handlers
  existingMarkAsDoneHandler: (entity: EntityData) => void,
  existingDeleteHandler: (entity: EntityData) => void
) {
  // Create original context
  const originalContext = createSoupContext();

  // Wrap with actions
  const contextWithActions = wrapSoupContextWithActions(
    originalContext,
    () => 'inbox'
  );

  // Register your existing handlers
  registerCommonActions(contextWithActions, {
    markAsDone: (entity) => {
      existingMarkAsDoneHandler(entity);
      return { success: true };
    },
    delete: (entity) => {
      existingDeleteHandler(entity);
      return { success: true };
    },
  });

  // Now you can gradually migrate your components to use:
  // - contextWithActions.executeAction() instead of direct handler calls
  // - contextWithActions.getActionDisabledState() for disabled states
  // - contextWithActions.handleEntityClick() for selection

  return contextWithActions;
}

/**
 * Compatibility layer for existing components
 */
export function createLegacyCompatibleHandlers(
  contextWithActions: ReturnType<typeof wrapSoupContextWithActions>
) {
  return {
    // Legacy handler that matches existing signatures
    markEntityAsDone: (entity: EntityData) =>
      contextWithActions.executeAction('mark_as_done', entity),

    // Enhanced bulk handler
    onClickRowAction: (entity: EntityData, type: string) => {
      if (type === 'done') {
        return contextWithActions.executeAction('mark_as_done', entity);
      }
      // Add other action mappings as needed
    },

    // Enhanced disabled state calculation
    disabledActions: () => contextWithActions.getActionDisabledState(),

    // Selection handlers
    onEntityClick: (entity: EntityData, event: MouseEvent) =>
      contextWithActions.handleEntityClick(entity, event),
  };
}
