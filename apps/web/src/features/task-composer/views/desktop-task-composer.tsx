import {
  TaskTemplateControls,
  TaskTemplateNameStrip,
} from '@app/features/task-templates/views/task-template-controls';
import { EntityComposer } from '@ui';
import { Show } from 'solid-js';
import type { TaskComposerController } from '../primitives/task-composer';
import { TaskComposerParts } from './shared/task-composer-parts';

/** The task composer in a split or the desktop dialog. */
export function DesktopTaskComposer(props: {
  composer: TaskComposerController;
}) {
  return (
    <TaskComposerParts.Root composer={props.composer}>
      <EntityComposer.Header>
        <Show
          when={props.composer.templatesEnabled()}
          fallback={<div class="flex-1" />}
        >
          <TaskTemplateControls composer={props.composer} />
        </Show>
        <TaskComposerParts.ClearDraft />
        <TaskComposerParts.ContinueInSplit />
        <TaskComposerParts.Close />
      </EntityComposer.Header>
      <TaskComposerParts.Recovery />
      <EntityComposer.Main inert={props.composer.isSavingTemplate()}>
        <Show when={props.composer.templatesEnabled()}>
          <TaskTemplateNameStrip composer={props.composer} />
        </Show>
        <TaskComposerParts.Title />
        <TaskComposerParts.Body />
        <Show when={!props.composer.isTemplateMode()}>
          <div class="shrink-0 flex items-center py-2">
            <TaskComposerParts.Attach />
          </div>
        </Show>
        <TaskComposerParts.Properties />
      </EntityComposer.Main>
      <TaskComposerParts.ErrorMessage />
      {/* The team switch, Create More and Create Task need about 400px; a
          narrow split wraps the actions to their own row. */}
      <EntityComposer.Footer class="flex-wrap items-center">
        <TaskComposerParts.ShareToggle />
        <div class="min-w-0 ml-auto flex flex-wrap items-center justify-end gap-3">
          <TaskComposerParts.LinkInSourceToggle />
          <TaskComposerParts.CreateMoreToggle />
          <TaskComposerParts.CancelTemplate />
          <TaskComposerParts.Submit />
        </div>
      </EntityComposer.Footer>
      <Show when={!props.composer.isTemplateMode()}>
        <TaskComposerParts.SimilarTasks />
      </Show>
    </TaskComposerParts.Root>
  );
}
