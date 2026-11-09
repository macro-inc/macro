import { TaskTemplateControls } from '@app/features/task-templates/task-template-controls';
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
        <TaskTemplateControls composer={props.composer} />
        <TaskComposer.ClearDraft />
        <TaskComposer.ContinueInSplit />
        <TaskComposer.Close />
      </EntityComposer.Header>
      <TaskComposer.Recovery />
      <EntityComposer.Main inert={props.composer.isSavingTemplate()}>
        <TaskComposer.Title />
        <TaskComposer.Body />
        <Show when={!props.composer.isTemplateMode()}>
          <div class="shrink-0 flex items-center py-2">
            <TaskComposer.Attach />
          </div>
        </Show>
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
          <TaskComposer.CancelTemplate />
          <TaskComposer.Submit />
        </div>
      </EntityComposer.Footer>
      <Show when={!props.composer.isTemplateMode()}>
        <TaskComposer.SimilarTasks />
      </Show>
    </TaskComposer.Root>
  );
}
