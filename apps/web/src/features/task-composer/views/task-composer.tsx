import { EntityComposer } from '@ui';
import type { TaskComposerController } from '../primitives/task-composer';
import { TaskComposerParts } from './shared/task-composer-parts';

/** The task composer in a split or the desktop dialog. */
export function TaskComposer(props: { composer: TaskComposerController }) {
  return (
    <TaskComposerParts.Root composer={props.composer}>
      <EntityComposer.Header>
        <div class="flex-1 flex items-center">
          <TaskComposerParts.ContinueInSplit />
        </div>
        <TaskComposerParts.ClearDraft />
        <TaskComposerParts.Close />
      </EntityComposer.Header>
      <TaskComposerParts.Recovery />
      <EntityComposer.Main>
        <TaskComposerParts.Title />
        <TaskComposerParts.Body />
        <div class="shrink-0 flex items-center py-2">
          <TaskComposerParts.Attach />
        </div>
        <TaskComposerParts.Properties />
      </EntityComposer.Main>
      <TaskComposerParts.ErrorMessage />
      {/* The team switch, Create More and Create Task need about 400px; a
          narrow split wraps the actions to their own row. */}
      <EntityComposer.Footer class="flex-wrap items-center">
        <TaskComposerParts.ShareToggle />
        <div class="ml-auto flex items-center gap-3">
          <TaskComposerParts.LinkInSourceToggle />
          <TaskComposerParts.CreateMoreToggle />
          <TaskComposerParts.Submit />
        </div>
      </EntityComposer.Footer>
      <TaskComposerParts.SimilarTasks />
    </TaskComposerParts.Root>
  );
}
