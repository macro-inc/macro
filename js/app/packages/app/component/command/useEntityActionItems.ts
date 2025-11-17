import { isEntityData } from '@macro-entity';
import type { Accessor } from 'solid-js';
import { type CommandItemCard, konsoleContextInformation } from './KonsoleItem';

const ACTION_IDS = [
  'mark_as_done',
  'rename',
  'delete',
  'move_to_project',
  'copy',
  'move_to_split',
] as const;

type ActionID = (typeof ACTION_IDS)[number];

type CommandItem = Extract<CommandItemCard, { type: 'command' }>;
type EntityActionCommandItemCard = Omit<CommandItem, 'data'> & {
  data: Omit<CommandItem['data'], 'id'> & { id: ActionID };
};

export const isEntityActionItem = (
  item: CommandItemCard
): item is EntityActionCommandItemCard => {
  return (ACTION_IDS as ReadonlyArray<string>).includes(item.data.id);
};

const getSelectedEntitiesContextInformation = () => {
  const context = konsoleContextInformation();
  const entities = context.selectedEntities;
  const clearSelection = context.clearSelection as (() => void) | undefined;

  if (!context || !entities) return;

  if (!Array.isArray(entities)) return;

  if (!entities.every(isEntityData)) {
    return;
  }

  return { entities, clearSelection };
};

export function useEntityActionItems(): Accessor<
  EntityActionCommandItemCard[]
> {
  // const items: EntityActionCommandItemCard[] = [
  //   {
  //     type: 'command',
  //     data: {
  //       id: 'rename',
  //       name: 'Rename',
  //       handler() {
  //         const selectionInfo = getSelectedEntitiesContextInformation();

  //         if (!selectionInfo || !selectionInfo.entities.length) return true;

  //         try {
  //           openBulkEditEntityModal({
  //             view: 'rename',
  //             entities: () => selectionInfo.entities,
  //           });
  //         } catch (err) {
  //           console.error('Failed to open unified list', err);
  //         }

  //         return true;
  //       },
  //       hotkeys: [],
  //     },
  //   },
  //   {
  //     type: 'command',
  //     data: {
  //       id: 'move_to_project',
  //       name: 'Move to project',
  //       handler() {
  //         const selectionInfo = getSelectedEntitiesContextInformation();

  //         if (!selectionInfo || !selectionInfo.entities.length) return true;

  //         try {
  //           openBulkEditEntityModal({
  //             view: 'moveToProject',
  //             entities: () => selectionInfo.entities,
  //           });
  //         } catch (err) {
  //           // Will throw an error if trying to use this action outside the unified list
  //           // Specifically outside a split panel context

  //           console.error('Failed to open unified list', err);
  //         }

  //         return true;
  //       },
  //       hotkeys: [],
  //     },
  //   },
  //   {
  //     type: 'command',
  //     data: {
  //       id: 'mark_as_done',
  //       name: 'Mark as done',
  //       handler() {
  //         console.log('MARK AS DONE HANDLER');
  //         const selectionInfo = getSelectedEntitiesContextInformation();
  //         if (!selectionInfo || !selectionInfo.entities.length) return true;

  //         try {
  //           selectionInfo.entities;
  //         } catch (err) {
  //           console.error('Failed to mark entities', err);
  //         }

  //         return true;
  //       },
  //       hotkeys: [],
  //     },
  //   },

  //   {
  //     type: 'command',
  //     data: {
  //       id: 'copy',
  //       name: 'Duplicate',
  //       handler() {
  //         const selectionInfo = getSelectedEntitiesContextInformation();

  //         if (!selectionInfo || !selectionInfo.entities.length) return true;

  //         try {
  //           // TODO - implement bulk duplicate
  //           selectionInfo.entities;
  //         } catch (err) {
  //           console.error('Failed to duplicate entities', err);
  //         }

  //         return true;
  //       },
  //       hotkeys: [],
  //     },
  //   },

  //   {
  //     type: 'command',
  //     data: {
  //       id: 'delete',
  //       name: 'Delete',
  //       handler() {
  //         const selectionInfo = getSelectedEntitiesContextInformation();

  //         if (!selectionInfo || !selectionInfo.entities.length) return true;

  //         try {
  //           openBulkEditEntityModal({
  //             view: 'delete',
  //             entities: () => selectionInfo.entities,
  //           });
  //           // Selection will be cleared after successful deletion in the modal
  //         } catch (err) {
  //           console.error('Failed to open bulk delete modal', err);
  //         }

  //         return true;
  //       },
  //       hotkeys: [],
  //     },
  //   },
  // ];

  return () => items;
}
