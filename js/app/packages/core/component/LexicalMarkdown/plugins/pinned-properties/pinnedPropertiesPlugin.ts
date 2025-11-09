import { mergeRegister } from '@lexical/utils';
import {
  $getRoot,
  $getState,
  $setState,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  createState,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';

const pinnedPropertyIdsState = createState('pinnedPropertyIds', {
  parse: (value: unknown): string[] => {
    if (value === undefined || value === null) {
      return [];
    }
    if (typeof value === 'object') {
      const obj = value as any;
      const result = Array.isArray(obj)
        ? obj.filter((id: unknown) => typeof id === 'string')
        : [];
      return result;
    }
    return [];
  },
});

/**
 * Get all property IDs from the root node
 * Must be called within an editor.read() or editor.update() callback
 */
export function $getPinnedProperties(): string[] {
  const root = $getRoot();
  return $getState(root, pinnedPropertyIdsState);
}

/**
 * Set property IDs on the root node
 * Must be called within an editor.update() callback
 */
export function $setPinnedProperties(propertyIds: string[]): void {
  const root = $getRoot();
  $setState(root, pinnedPropertyIdsState, propertyIds);
}

/**
 * Add a property ID to the root node
 * Must be called within an editor.update() callback
 * @param propertyId - Property ID to add
 */
export function $addPinnedProperty(propertyId: string): void {
  const currentIds = $getPinnedProperties();
  if (!currentIds.includes(propertyId)) {
    $setPinnedProperties([...currentIds, propertyId]);
  }
}

/**
 * Remove a property ID from the root node
 * Must be called within an editor.update() callback
 * @param propertyId - Property ID to remove
 */
export function $removePinnedProperty(propertyId: string): void {
  const currentIds = $getPinnedProperties();
  const filteredIds = currentIds.filter((id) => id !== propertyId);
  $setPinnedProperties(filteredIds);
}

/**
 * Check if a property ID exists on the root node
 * Must be called within an editor.read() or editor.update() callback
 * @param propertyId - Property ID to check
 */
export function $hasPinnedProperty(propertyId: string): boolean {
  const currentIds = $getPinnedProperties();
  return currentIds.includes(propertyId);
}

/**
 * Clear all property IDs from the root node
 * Must be called within an editor.update() callback
 */
export function $clearPinnedProperties(): void {
  $setPinnedProperties([]);
}

/**
 * Get property IDs from the root node (with automatic editor.read)
 * @param editor - The Lexical editor instance
 * @returns Promise that resolves to array of property IDs
 */
export function getPinnedProperties(editor: LexicalEditor): Promise<string[]> {
  return new Promise((resolve) => {
    editor.getEditorState().read(() => {
      resolve($getPinnedProperties());
    });
  });
}

/**
 * Command to add a pinned property ID to the document
 */
export const ADD_PINNED_PROPERTY_COMMAND: LexicalCommand<string> =
  createCommand('ADD_PINNED_PROPERTY_COMMAND');

/**
 * Command to remove a pinned property ID from the document
 */
export const REMOVE_PINNED_PROPERTY_COMMAND: LexicalCommand<string> =
  createCommand('REMOVE_PINNED_PROPERTY_COMMAND');

function registerPinnedPropertiesPlugin(editor: LexicalEditor) {
  return mergeRegister(
    // Register ADD command
    editor.registerCommand(
      ADD_PINNED_PROPERTY_COMMAND,
      (propertyId: string) => {
        $addPinnedProperty(propertyId);
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    // Register REMOVE command
    editor.registerCommand(
      REMOVE_PINNED_PROPERTY_COMMAND,
      (propertyId: string) => {
        $removePinnedProperty(propertyId);
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    )
  );
}

/**
 * Plugin for managing pinned properties on the document root node
 *
 * Exposes two commands:
 * - ADD_PINNED_PROPERTY_COMMAND: Add a property ID to the pinned list
 * - REMOVE_PINNED_PROPERTY_COMMAND: Remove a property ID from the pinned list
 *
 * To get pinned properties:
 * - getPinnedProperties(editor) - async function for use outside editor callbacks
 * - $getPinnedProperties() - for use within editor.read() or editor.update()
 *
 * @example
 * ```typescript
 * import {
 *   pinnedPropertiesPlugin,
 *   ADD_PINNED_PROPERTY_COMMAND,
 *   REMOVE_PINNED_PROPERTY_COMMAND,
 *   getPinnedProperties,
 *   $getPinnedProperties
 * } from '@core/component/LexicalMarkdown/plugins/pinned-properties';
 *
 * // Setup
 * plugins.use(pinnedPropertiesPlugin());
 *
 * // Add/Remove via commands
 * editor.dispatchCommand(ADD_PINNED_PROPERTY_COMMAND, 'property-id-123');
 * editor.dispatchCommand(REMOVE_PINNED_PROPERTY_COMMAND, 'property-id-123');
 *
 * // Get data (async)
 * const ids = await getPinnedProperties(editor);
 *
 * // Or within editor callback
 * editor.getEditorState().read(() => {
 *   const ids = $getPinnedProperties();
 * });
 * ```
 */
export function pinnedPropertiesPlugin() {
  return (editor: LexicalEditor) => {
    return registerPinnedPropertiesPlugin(editor);
  };
}
