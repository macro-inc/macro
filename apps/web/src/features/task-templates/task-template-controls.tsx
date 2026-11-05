import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import CopyIcon from '@icon/system/regular/copy.svg';
import type { TaskTemplate } from '@service-storage/generated/schemas/taskTemplate';
import {
  Button,
  ConfirmDialog,
  type ManagedDialogProps,
  openDialog,
  useImperativeDialog,
} from '@ui';
import {
  type Accessor,
  type ComponentProps,
  createEffect,
  createSignal,
  getOwner,
  onCleanup,
  Show,
} from 'solid-js';
import type { TaskComposerController } from '../task-composer/primitives/task-composer';
import { TemplateDetails } from './components/template-details';
import { TemplateDropdown, TemplatePicker } from './components/template-picker';
import { taskTemplateContents } from './queries/template-mapping';
import {
  useDeleteTaskTemplate,
  useTaskTemplatesQuery,
} from './queries/templates';

type DialogScope = ManagedDialogProps & {
  viewerId: Accessor<string | undefined>;
  isCurrent(): boolean;
};

function dialogLifetime(props: DialogScope) {
  const viewer = props.viewerId();
  let alive = true;
  const current = () =>
    alive &&
    Boolean(viewer) &&
    viewer === props.viewerId() &&
    props.isCurrent();
  createEffect(() => {
    if (!current()) props.onOpenChange(false);
  });
  onCleanup(() => {
    alive = false;
  });
  return { viewer, current };
}

function DeleteTemplateDialog(
  props: DialogScope & { template: TaskTemplate; onDeleted(): void }
) {
  const lifetime = dialogLifetime(props);
  const mutation = useDeleteTaskTemplate();
  const [failure, setFailure] = createSignal<unknown>();
  const remove = async () => {
    if (!lifetime.current() || !lifetime.viewer || mutation.isPending) return;
    setFailure(undefined);
    try {
      await mutation.mutateAsync({
        viewerId: lifetime.viewer,
        id: props.template.id,
        revision: props.template.revision,
      });
      if (lifetime.current()) {
        props.onDeleted();
        props.onOpenChange(false);
      }
    } catch (error) {
      if (lifetime.current()) setFailure(error);
    }
  };
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
          <Show when={failure()}>
            <p role="alert" class="text-sm text-failure-ink">
              {thrownResultErrorHasCode(failure(), 'CONFLICT')
                ? t('create.taskTemplateConflict')
                : t('create.taskTemplateDeleteError')}
            </p>
          </Show>
        </div>
      }
      confirmLabel={t('create.taskTemplateDelete')}
      tone="danger"
      pending={mutation.isPending}
      onConfirm={() => fireAndForget(remove(), 'task-templates')}
    />
  );
}

function ReplaceDraftDialog(props: DialogScope & { onConfirm(): void }) {
  const lifetime = dialogLifetime(props);
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('create.taskTemplateReplaceDraftTitle')}
      body={t('create.taskTemplateReplaceDraftBody')}
      confirmLabel={t('create.taskTemplateEdit')}
      onConfirm={() => {
        if (!lifetime.current()) return;
        props.onOpenChange(false);
        props.onConfirm();
      }}
    />
  );
}

function ScopedTemplatePicker(
  props: DialogScope & ComponentProps<typeof TemplatePicker>
) {
  dialogLifetime(props);
  return <TemplatePicker {...props} />;
}

/** Selection belongs to the composer, not the picker presentation lifetime. */
export function TaskTemplateControls(props: {
  composer: TaskComposerController;
  compact?: boolean;
}) {
  const viewerId = useUserId();
  const owner = getOwner();
  const picker = useImperativeDialog(ScopedTemplatePicker);
  const [dropdownOpen, setDropdownOpen] = createSignal(false);
  const [pickerScope, setPickerScope] = createSignal<string>();
  const team = () => props.composer.team();
  const scopeKey = () => `${viewerId() ?? ''}:${team()?.id ?? ''}`;
  const query = useTaskTemplatesQuery({
    viewerId,
    teamId: () => team()?.id,
    enabled: () => dropdownOpen() || picker.isOpen(),
  });
  const canUse = () =>
    viewerId() === props.composer.draftOwner && !props.composer.isCreating();
  const isCurrent = () => canUse() && pickerScope() === scopeKey();
  createEffect(() => {
    if (dropdownOpen() && !isCurrent()) setDropdownOpen(false);
  });
  const selectedKey = () => {
    const selection = props.composer.templateSelection();
    return selection.kind === 'saved' || selection.kind === 'editing'
      ? selection.template.id
      : selection.kind;
  };
  const selectedLabel = () => {
    const selection = props.composer.templateSelection();
    if (selection.kind === 'none') return t('create.taskTemplateNone');
    if (selection.kind === 'new') return t('create.taskTemplateNew');
    if (selection.kind === 'editing')
      return t('create.taskTemplateEditingNamed', {
        name: selection.template.name,
      });
    return selection.template.name;
  };
  const editableTemplate = (template: TaskTemplate) => ({
    id: template.id,
    name: template.name,
    teamId: template.teamId ?? null,
    revision: template.revision,
    contents: taskTemplateContents(
      template.configuration,
      props.composer.availableProperties()
    ),
  });
  const editTemplate = (template: TaskTemplate) => {
    if (!isCurrent()) return;
    const edit = () => {
      if (isCurrent()) props.composer.editTemplate(editableTemplate(template));
    };
    if (props.composer.hasDraftChanges()) {
      openDialog(
        ReplaceDraftDialog,
        { viewerId, isCurrent, onConfirm: edit },
        { owner }
      );
    } else {
      edit();
    }
  };
  const pickerProps = () => ({
    loading: query.isPending,
    error: query.isError,
    selectedKey: selectedKey(),
    selectedLabel: selectedLabel(),
    items: (query.isSuccess ? query.data : []).map((template) => ({
      key: template.id,
      label: template.name,
      shared: Boolean(template.teamId),
      select: () => {
        if (!isCurrent()) return;
        props.composer.selectTemplate(editableTemplate(template));
        const available = new Set(
          props.composer
            .availableProperties()
            .map((definition) => definition.id)
        );
        if (template.configuration.propertyIds.some((id) => !available.has(id)))
          toast.alert(t('create.taskTemplateUnavailableProperties'));
      },
      edit: template.canManage ? () => editTemplate(template) : undefined,
      remove: template.canManage
        ? () => {
            if (!isCurrent()) return;
            openDialog(
              DeleteTemplateDialog,
              {
                template,
                viewerId,
                isCurrent,
                onDeleted: () => {
                  if (selectedKey() === template.id)
                    props.composer.selectNoTemplate();
                },
              },
              { owner }
            );
          }
        : undefined,
    })),
    onRetry: () => fireAndForget(query.refetch(), 'task-templates'),
    onSelectNone: () => {
      if (isCurrent()) props.composer.selectNoTemplate();
    },
    onNew: () => {
      if (isCurrent()) props.composer.startNewTemplate();
    },
  });
  const openPicker = () => {
    if (!canUse()) return;
    setPickerScope(scopeKey());
    picker.open(() => ({ viewerId, isCurrent, ...pickerProps() }));
  };
  const changeDropdownOpen = (open: boolean) => {
    if (open) {
      if (!canUse()) return;
      setPickerScope(scopeKey());
    }
    setDropdownOpen(open);
  };
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <TemplateDropdown
          {...pickerProps()}
          open={dropdownOpen()}
          onOpenChange={changeDropdownOpen}
          disabled={
            !canUse() || props.composer.availableProperties().length === 0
          }
        />
      }
    >
      <Button
        variant="secondary"
        size={props.compact ? 'icon-sm' : 'sm'}
        aria-label={t('create.taskTemplateSelected', { name: selectedLabel() })}
        tooltip={props.compact ? selectedLabel() : undefined}
        disabled={
          !canUse() || props.composer.availableProperties().length === 0
        }
        onClick={openPicker}
      >
        <CopyIcon class="size-4 shrink-0" />
        <Show when={!props.compact}>{selectedLabel()}</Show>
      </Button>
    </Show>
  );
}

/** New and edited templates reuse the task fields rendered directly below. */
export function TaskTemplateDetails(props: {
  composer: TaskComposerController;
}) {
  const details = () => {
    const selection = props.composer.templateSelection();
    if (selection.kind === 'new')
      return { name: selection.name, teamId: selection.teamId, editing: false };
    if (selection.kind === 'editing')
      return {
        name: selection.name,
        teamId: selection.template.teamId,
        editing: true,
      };
    return undefined;
  };
  return (
    <Show when={details()}>
      {(selection) => (
        <TemplateDetails
          name={selection().name}
          teamId={selection().teamId}
          team={props.composer.team()}
          editing={selection().editing}
          pending={props.composer.isCreating()}
          onNameChange={props.composer.setTemplateName}
          onTeamIdChange={props.composer.setTemplateTeamId}
        />
      )}
    </Show>
  );
}
