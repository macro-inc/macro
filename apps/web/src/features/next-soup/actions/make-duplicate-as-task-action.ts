import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { toast } from '@core/component/Toast/Toast';
import {
  editorStateAsMarkdown,
  initializeEditorWithState,
} from '@core/component/LexicalMarkdown/utils';
import { createTask } from '@core/util/create';
import type { EntityData } from '@entity';
import { syncServiceClient } from '@service-sync/client';
import type { EntityActionListState } from './entity-action-context';

export const makeDuplicateAsTaskAction = () => {
  const canExecute = (entity: EntityData): boolean => {
    if (entity.type !== 'document') return false;
    if (entity.fileType !== 'md') return false;
    if (entity.subType?.type === 'task') return false;
    return true;
  };

  const execute = async (entities: EntityData[]) => {
    const entity = entities[0];
    if (!entity || entity.type !== 'document') return;

    const rawState = await syncServiceClient.getRaw({
      documentId: entity.id,
    });

    const { editor } = createLexicalWrapper({
      type: 'markdown',
      namespace: 'duplicate-as-task-extractor',
      isInteractable: () => false,
    });

    initializeEditorWithState(editor, rawState);
    const markdownContent = editorStateAsMarkdown(editor, 'internal');

    const taskId = await createTask({
      title: entity.name,
      content: markdownContent,
      source: 'duplicate-as-task',
    });

    if (!taskId) {
      toast.failure('Failed to create task');
      return;
    }

    toast.success('Created task');
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState
  ) => {
    await execute(entities);
    soup.selection.clear();
  };

  return { canExecute, execute, executeWithSoup };
};
