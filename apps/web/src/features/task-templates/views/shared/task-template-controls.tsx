import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import type { TaskTemplate } from '@service-storage/generated/schemas/taskTemplate';
import { ConfirmDialog, type ManagedDialogProps, openDialog } from '@ui';
import {
  type Accessor,
  type ComponentProps,
  createMemo,
  getOwner,
  Show,
} from 'solid-js';
import type { TaskComposerController } from '../../../task-composer/primitives/task-composer';
import { TemplatePicker } from '../../components/template-picker';
import {
  createTemplateControls,
  createTemplateDeletion,
  createTemplateDialogLifetime,
  type TemplateDialogScope,
} from '../../primitives/template-controls';
import { taskTemplateForComposer } from '../../queries/template-mapping';
import {
  useDeleteTaskTemplate,
  useTaskTemplatesQuery,
} from '../../queries/templates';

type DialogScope = ManagedDialogProps & TemplateDialogScope;

function DeleteTemplateDialog(
  props: DialogScope & {
    template: Pick<TaskTemplate, 'id' | 'name' | 'revision'>;
    onDeleted(): void;
  }
) {
  const mutation = useDeleteTaskTemplate();
  const deletion = createTemplateDeletion({
    scope: props,
    pending: () => mutation.isPending,
    deleteTemplate: (viewerId) =>
      mutation.mutateAsync({
        viewerId,
        id: props.template.id,
        revision: props.template.revision,
      }),
    onDeleted: props.onDeleted,
    close: () => props.onOpenChange(false),
  });
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!mutation.isPending) props.onOpenChange(open);
      }}
      title={t('create.taskTemplateDeleteTitle', { name: props.template.name })}
      body={
        <div class="flex flex-col gap-2">
          <p>{t('create.taskTemplateDeleteBody')}</p>
          <Show when={deletion.failure()}>
            <p role="alert" class="text-sm text-failure-ink">
              {thrownResultErrorHasCode(deletion.failure(), 'CONFLICT')
                ? t('create.taskTemplateConflict')
                : t('create.taskTemplateDeleteError')}
            </p>
          </Show>
        </div>
      }
      confirmLabel={t('create.taskTemplateDelete')}
      tone="danger"
      pending={mutation.isPending}
      onConfirm={() => fireAndForget(deletion.remove(), 'task-templates')}
    />
  );
}

function ReplaceDraftDialog(props: DialogScope & { onConfirm(): void }) {
  const lifetime = createTemplateDialogLifetime(props, () =>
    props.onOpenChange(false)
  );
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('create.taskTemplateSwitchTitle')}
      body={t('create.taskTemplateSwitchBody')}
      confirmLabel={t('create.taskTemplateSwitch')}
      onConfirm={() => {
        if (!lifetime.current()) return;
        props.onOpenChange(false);
        props.onConfirm();
      }}
    />
  );
}

export function ScopedTemplatePicker(
  props: DialogScope & ComponentProps<typeof TemplatePicker>
) {
  createTemplateDialogLifetime(props, () => props.onOpenChange(false));
  return <TemplatePicker {...props} />;
}

/** Selection belongs to the composer, not the picker presentation lifetime. */
export function templateControlsScope(
  composer: TaskComposerController,
  viewerId: Accessor<string | undefined>
) {
  return [
    viewerId(),
    composer.team()?.id,
    composer.templatesEnabled(),
    composer.isCreating(),
  ].join(':');
}

/** Share scoped selection, query, and dialog lifetimes across both views. */
export function useTaskTemplateControls(props: {
  composer: TaskComposerController;
  viewerId: Accessor<string | undefined>;
  isPickerOpen: Accessor<boolean>;
}) {
  const owner = getOwner();
  const controls = createTemplateControls({
    composer: props.composer,
    viewerId: props.viewerId,
    templates: () => templates(),
    confirmReplace: (scope, onConfirm) =>
      openDialog(ReplaceDraftDialog, { ...scope, onConfirm }, { owner }),
    confirmDelete: (scope, template, onDeleted) =>
      openDialog(
        DeleteTemplateDialog,
        { ...scope, template, onDeleted },
        { owner }
      ),
    notifyUnavailable: () =>
      toast.alert(t('create.taskTemplateUnavailableProperties')),
  });
  const query = useTaskTemplatesQuery({
    viewerId: props.viewerId,
    teamId: () => props.composer.team()?.id,
    enabled: () =>
      props.composer.templatesEnabled() &&
      (props.isPickerOpen() ||
        props.composer.templateSelection().kind !== 'none'),
  });
  const templates = createMemo(() =>
    (query.isSuccess ? query.data : []).map((template) =>
      taskTemplateForComposer(template, props.composer.templateProperties())
    )
  );
  const items = createMemo(controls.items);
  const pickerProps = () => ({
    loading: query.isPending,
    error: query.isError,
    selectedKey: controls.selectedKey(),
    selectedLabel: controls.selectedLabel(),
    teamName: props.composer.team()?.name ?? t('create.taskTemplateTeam'),
    dirty: props.composer.areTemplateFieldsDirty(),
    pending: props.composer.isCreating(),
    onReset: controls.selectedCanManage() ? controls.reset : undefined,
    onUpdate: controls.selectedCanManage() ? controls.update : undefined,
    items: items(),
    onRetry: () => {
      if (controls.isCurrent())
        fireAndForget(query.refetch(), 'task-templates');
    },
    onSelectNone: controls.selectNone,
    onNew: controls.startNew,
  });
  return { controls, pickerProps };
}
