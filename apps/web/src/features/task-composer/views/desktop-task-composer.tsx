import { EntityComposer } from '@ui';
import type { TaskComposerController } from '../primitives/task-composer';
import { TaskComposer } from './task-composer-parts';

/** The task composer in a split or the desktop dialog. */
export function DesktopTaskComposer(props: {
  composer: TaskComposerController;
}) {
  return (
    <TaskComposer.Root composer={props.composer}>
      <EntityComposer.Header>
        <div class="flex-1 flex items-center">
          <TaskComposer.ContinueInSplit />
        </div>
        <TaskComposer.ClearDraft />
        <TaskComposer.Close />
      </EntityComposer.Header>
      <TaskComposer.Recovery />
      <EntityComposer.Main>
        <TaskComposer.Title />
        <TaskComposer.Body />
        <div class="shrink-0 flex items-center py-2">
          <TaskComposer.Attach />
        </div>
        <TaskComposer.Properties />
      </EntityComposer.Main>
      <TaskComposer.ErrorMessage />
      {/* The team switch, Create More and Create Task need about 400px; a
          narrow split wraps the actions to their own row. */}
      <EntityComposer.Footer class="flex-wrap items-center">
        <TaskComposer.ShareToggle />
        <div class="ml-auto flex items-center gap-3">
          <TaskComposer.LinkInSourceToggle />
          <TaskComposer.CreateMoreToggle />
          <TaskComposer.Submit />
        </div>
      </EntityComposer.Footer>
      <TaskComposer.SimilarTasks />
    </TaskComposer.Root>
  );
}
