import { MenuItem } from '@core/component/Menu';

export type EntityActionType =
  | 'mark_as_done'
  | 'rename'
  | 'delete'
  | 'move_to_project'
  | 'copy'
  | 'move_to_split';

interface EntityActionsMenuItemsProps {
  onSelectAction: (action: EntityActionType) => void;
  disabled?: {
    markAsDone?: boolean;
    delete?: boolean;
    rename?: boolean;
    moveToProject?: boolean;
    copy?: boolean;
    moveToSplit?: boolean;
  };
}

export const EntityActionsMenuItems = (props: EntityActionsMenuItemsProps) => {
  const actionCallback = (action: EntityActionType) => () =>
    props.onSelectAction(action);

  const handleBulkMarkAsDone = actionCallback('mark_as_done');
  const handleBulkDelete = actionCallback('delete');
  const handleBulkRename = actionCallback('rename');
  const handleBulkMoveToProject = actionCallback('move_to_project');
  const handleBulkCopy = actionCallback('copy');
  const handleBulkMoveToSplit = actionCallback('move_to_split');

  const canBulkMarkAsDone = () => {
    // TODO - See if we can disable this action ahead of time?
    return true && props.disabled?.markAsDone === false;
  };

  const canBulkDelete = () => {
    // TODO - See if we can disable this action ahead of time?
    return true && props.disabled?.delete === false;
  };

  const canBulkRename = () => {
    // TODO - See if we can disable this action ahead of time?
    return true && props.disabled?.rename === false;
  };

  const canBulkMoveToProject = () => {
    // TODO - See if we can disable this action ahead of time?
    return true && props.disabled?.moveToProject === false;
  };

  const canBulkCopy = () => {
    // TODO - See if we can disable this action ahead of time?
    return true && props.disabled?.copy === false;
  };

  const canBulkMoveToSplit = () => {
    // TODO - See if we can disable this action ahead of time?
    return true && props.disabled?.moveToSplit === false;
  };

  return (
    <>
      <MenuItem
        text="Mark as Done"
        onClick={handleBulkMarkAsDone}
        disabled={!canBulkMarkAsDone()}
      />
      <MenuItem
        text="Delete"
        onClick={handleBulkDelete}
        disabled={!canBulkDelete()}
      />
      <MenuItem
        text="Rename"
        onClick={handleBulkRename}
        disabled={!canBulkRename()}
      />
      <MenuItem
        text="Move to Project"
        onClick={handleBulkMoveToProject}
        disabled={!canBulkMoveToProject()}
      />
      <MenuItem
        text="Copy"
        onClick={handleBulkCopy}
        disabled={!canBulkCopy()}
      />
      <MenuItem
        text="Open in new split"
        onClick={handleBulkMoveToSplit}
        disabled={!canBulkMoveToSplit()}
      />
    </>
  );
};
