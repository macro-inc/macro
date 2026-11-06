import {
  TaskTemplateControls,
  TaskTemplateDetails,
} from '@app/features/task-templates/task-template-controls';
import { EntityComposer } from '@ui';
import { Show } from 'solid-js';
import type { TaskComposerController } from '../primitives/task-composer';
import { TaskComposer } from './task-composer-parts';

/** The task composer in a split or the desktop dialog. */
export function DesktopTaskComposer(props: {
  composer: TaskComposerController;
}) {
  return (
    <TaskComposer.Root composer={props.composer}>
      <EntityComposer.Header>
        <div class="min-w-0 flex-1 flex items-center gap-1">
          <TaskTemplateControls composer={props.composer} />
        </div>
        <TaskComposer.ClearDraft />
        <TaskComposer.ContinueInSplit />
        <TaskComposer.Close />
      </EntityComposer.Header>
      <TaskComposer.Recovery />
      <EntityComposer.Main inert={props.composer.isSavingTemplate()}>
        <TaskTemplateDetails composer={props.composer} />
        <Show when={props.composer.templateSelection().kind !== 'editing'}>
          <TaskComposer.Title />
        </Show>
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
        <div class="min-w-0 ml-auto flex flex-wrap items-center justify-end gap-3">
          <TaskComposer.LinkInSourceToggle />
          <TaskComposer.CreateMoreToggle />
          <TaskComposer.Submit />
        </div>
      </EntityComposer.Footer>
      <TaskComposer.SimilarTasks />
    </TaskComposer.Root>
  );
}
