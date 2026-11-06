import {
  isConfirmedTemplateUpdate,
  taskTemplateConfiguration,
  taskTemplateContents,
} from '@app/features/task-templates/queries/template-mapping';
import {
  useCreateTaskTemplate,
  useUpdateTaskTemplate,
} from '@app/features/task-templates/queries/templates';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { throwOnErr } from '@core/util/result';
import { getTaskTemplate } from '@service-storage/task-templates';
import { useQueryClient } from '@tanstack/solid-query';
import { Show } from 'solid-js';
import type { ComposeTaskProps } from './core/types';
import {
  createTaskComposer,
  type TaskComposerHost,
} from './primitives/task-composer';
import { DesktopTaskComposer } from './views/desktop-task-composer';
import { MobileTaskComposer } from './views/mobile-task-composer';

function createSplitTaskComposerHost(): TaskComposerHost {
  const splitPanel = useSplitPanelOrThrow();
  const queryClient = useQueryClient();
  const userId = useUserId();
  const createTemplate = useCreateTaskTemplate();
  const updateTemplate = useUpdateTaskTemplate();
  const { popoverSplit, openWithSplit } = useSplitLayout();
  const taskContent = (task: {
    id: string;
    optimisticSnapshot?: Uint8Array;
  }) => {
    const snapshotParams = task.optimisticSnapshot
      ? {
          params: { optimisticSnapshot: task.optimisticSnapshot },
          preserveParams: true as const,
        }
      : {};
    return { type: 'task' as const, id: task.id, ...snapshotParams };
  };
  return {
    userId,
    createTemplate: async (viewerId, selection, contents, definitions) => {
      if (userId() !== viewerId)
        throw new Error('Task template account changed');
      const created = await createTemplate.mutateAsync({
        viewerId,
        body: {
          id: selection.creationId,
          name: selection.name,
          teamId: selection.teamId,
          configuration: taskTemplateConfiguration(contents, definitions),
        },
      });
      if (userId() !== viewerId)
        throw new Error('Task template account changed');
      return {
        id: created.id,
        revision: created.revision,
        name: created.name,
        teamId: created.teamId ?? null,
        contents: taskTemplateContents(created.configuration, definitions),
      };
    },
    updateTemplate: async (viewerId, selection, contents, definitions) => {
      if (userId() !== viewerId)
        throw new Error('Task template account changed');
      const previous = await throwOnErr(() =>
        getTaskTemplate(selection.template.id)
      );
      if (userId() !== viewerId)
        throw new Error('Task template account changed');
      const configuration = taskTemplateConfiguration(
        contents,
        definitions,
        previous.configuration
      );
      const name = selection.name.trim();
      if (previous.revision !== selection.template.revision) {
        if (
          !isConfirmedTemplateUpdate(
            previous,
            selection.template,
            viewerId,
            name,
            configuration
          )
        )
          throw new Error('Task template update conflict');
        if (userId() !== viewerId)
          throw new Error('Task template account changed');
        await queryClient.invalidateQueries({
          queryKey: ['task-templates', viewerId],
        });
        if (userId() !== viewerId)
          throw new Error('Task template account changed');
        return {
          id: previous.id,
          revision: previous.revision,
          name: previous.name,
          teamId: previous.teamId ?? null,
          contents: taskTemplateContents(previous.configuration, definitions),
        };
      }
      if (userId() !== viewerId)
        throw new Error('Task template account changed');
      const updated = await updateTemplate.mutateAsync({
        viewerId,
        id: selection.template.id,
        body: { name, revision: selection.template.revision, configuration },
      });
      if (userId() !== viewerId)
        throw new Error('Task template account changed');
      return {
        id: updated.id,
        revision: updated.revision,
        name: updated.name,
        teamId: updated.teamId ?? null,
        contents: taskTemplateContents(updated.configuration, definitions),
      };
    },
    resolveAppLink: useMacroMentionLinkResolver(),
    isPopover: () => splitPanel.handle.isPopover(),
    fillSheet: () => splitPanel.fillDrawer?.(),
    setDisplayName: (name) => splitPanel.handle.setDisplayName(name),
    close: () => splitPanel.handle.close(),
    openComposer: (params) =>
      popoverSplit({ type: 'component', id: 'task-compose', params }),
    openTask: (task, options) =>
      openWithSplit(taskContent(task), {
        referredFrom: options.referredFrom,
        preferNewSplit: options.newSplit,
      }),
    openPendingTask: () => {
      const { split } = openWithSplit(
        { type: 'component', id: 'loading' },
        { referredFrom: 'launcher', preferNewSplit: true }
      );
      return {
        show: (task) =>
          split?.replace({
            next: taskContent(task),
            mergeHistory: true,
            referredFrom: 'launcher',
          }),
        cancel: () => split?.goBack(),
      };
    },
  };
}

/** Touch devices show a popover split in a bottom sheet, with its own layout. */
export function ComposeTask(props: ComposeTaskProps) {
  const composer = createTaskComposer(props, createSplitTaskComposerHost());
  return (
    <Show
      when={isTouchDevice() && composer.isPopover()}
      fallback={<DesktopTaskComposer composer={composer} />}
    >
      <MobileTaskComposer composer={composer} />
    </Show>
  );
}
