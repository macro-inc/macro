import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
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
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  Show,
} from 'solid-js';
import type { TaskComposerController } from '../task-composer/primitives/task-composer';
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
  props: DialogScope & {
    template: Pick<TaskTemplate, 'id' | 'name' | 'revision'>;
    onDeleted(): void;
  }
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
    enabled: () =>
      dropdownOpen() ||
      picker.isOpen() ||
      props.composer.templateSelection().kind !== 'none',
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
    if (selection.kind === 'none') return t('create.taskTemplateLabel');
    if (selection.kind === 'new') return t('create.taskTemplateNew');
    if (selection.kind === 'editing') return t('create.taskTemplateEdit');
    return selection.template.name;
  };
  const editableTemplate = (template: TaskTemplate) => ({
    id: template.id,
    name: template.name,
    teamId: template.teamId ?? null,
    revision: template.revision,
    contents: taskTemplateContents(
      template.configuration,
      props.composer.templateProperties()
    ),
  });
  const editTemplate = (template: TaskTemplate) => {
    if (!isCurrent() || !template.canManage) return;
    props.composer.editTemplate(editableTemplate(template));
  };
  const deleteTemplate = (
    template: Pick<TaskTemplate, 'id' | 'name' | 'revision'>
  ) => {
    const selection = props.composer.templateSelection();
    if (
      !canUse() ||
      !selectedCanManage() ||
      selection.kind !== 'editing' ||
      selection.template.id !== template.id
    )
      return;
    const scope = scopeKey();
    const current = () =>
      canUse() &&
      scopeKey() === scope &&
      props.composer.templateSelection() === selection;
    openDialog(
      DeleteTemplateDialog,
      {
        template,
        viewerId,
        isCurrent: current,
        onDeleted: () => {
          props.composer.cancelTemplateEdit();
          const restored = props.composer.templateSelection();
          if (restored.kind === 'saved' && restored.template.id === template.id)
            props.composer.detachTemplate();
        },
      },
      { owner }
    );
  };
  const selectedCanManage = () => {
    const selection = props.composer.templateSelection();
    if (selection.kind !== 'saved' && selection.kind !== 'editing')
      return false;
    const target = selection.template;
    if (viewerId() !== props.composer.draftOwner) return false;
    if (target.teamId && target.teamId !== team()?.id) return false;
    return (
      query.isSuccess &&
      query.data.some(
        (template) =>
          template.id === target.id &&
          (template.teamId ?? null) === target.teamId &&
          template.canManage
      )
    );
  };
  const switchTemplate = (replace: () => void) => {
    if (!isCurrent()) return;
    if (props.composer.isTemplateDirty()) {
      openDialog(
        ReplaceDraftDialog,
        { viewerId, isCurrent, onConfirm: replace },
        { owner }
      );
    } else {
      replace();
    }
  };
  const items = createMemo(() =>
    (query.isSuccess ? query.data : []).map((template) => ({
      key: template.id,
      label: template.name,
      shared: Boolean(template.teamId),
      select: () => {
        const selection = props.composer.templateSelection();
        if (
          selection.kind === 'saved' &&
          selection.template.id === template.id &&
          selection.template.revision === template.revision
        )
          return;
        switchTemplate(() => {
          if (!isCurrent()) return;
          props.composer.selectTemplate(editableTemplate(template));
          const available = new Set(
            props.composer
              .templateProperties()
              .map((definition) => definition.id)
          );
          if (
            template.configuration.propertyIds.some((id) => !available.has(id))
          )
            toast.alert(t('create.taskTemplateUnavailableProperties'));
        });
      },
      edit: template.canManage ? () => editTemplate(template) : undefined,
    }))
  );
  const pickerProps = () => ({
    loading: query.isPending,
    error: query.isError,
    selectedKey: selectedKey(),
    selectedLabel: selectedLabel(),
    teamName: team()?.name ?? t('create.taskTemplateTeam'),
    dirty: props.composer.areTemplateFieldsDirty(),
    pending: props.composer.isCreating(),
    onReset: selectedCanManage()
      ? () => {
          if (isCurrent() && selectedCanManage())
            props.composer.resetTemplateFields();
        }
      : undefined,
    onUpdate: selectedCanManage()
      ? () => {
          if (isCurrent() && selectedCanManage())
            fireAndForget(
              props.composer.updateTemplateFields(),
              'task-templates'
            );
        }
      : undefined,
    items: items(),
    onRetry: () => fireAndForget(query.refetch(), 'task-templates'),
    onSelectNone: () => {
      if (props.composer.templateSelection().kind === 'none') return;
      switchTemplate(() => {
        if (isCurrent()) props.composer.selectNoTemplate();
      });
    },
    onNew: () => {
      if (!isCurrent()) return;
      props.composer.startNewTemplate();
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
    <div class="min-w-0 flex-1 flex items-center justify-between gap-2">
      <Show
        when={props.composer.isTemplateMode()}
        fallback={
          <Show
            when={isTouchDevice()}
            fallback={
              <TemplateDropdown
                {...pickerProps()}
                open={dropdownOpen()}
                onOpenChange={changeDropdownOpen}
                disabled={!canUse() || !props.composer.definitionsReady()}
              />
            }
          >
            <Button
              variant="secondary"
              size={props.compact ? 'icon-sm' : 'sm'}
              aria-label={t('create.taskTemplateSelected', {
                name: selectedLabel(),
              })}
              disabled={!canUse() || !props.composer.definitionsReady()}
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openPicker}
            >
              <CopyIcon class="size-4 shrink-0" />
              <Show when={!props.compact}>{selectedLabel()}</Show>
              <Show when={props.composer.areTemplateFieldsDirty()}>
                <span class="size-1.5 shrink-0 rounded-full bg-accent" />
              </Show>
            </Button>
          </Show>
        }
      >
        <Button
          variant="ghost"
          size="sm"
          class="min-w-0"
          disabled={props.composer.isSavingTemplate()}
          onClick={props.composer.cancelTemplateEdit}
        >
          <CaretLeftIcon class="size-4 shrink-0" />
          <span class="truncate">{selectedLabel()}</span>
        </Button>
        <Show
          when={
            props.composer.templateSelection().kind === 'editing' &&
            selectedCanManage()
          }
        >
          <Button
            variant="secondary"
            size="xs"
            disabled={props.composer.isSavingTemplate()}
            onClick={() => {
              const selection = props.composer.templateSelection();
              if (selection.kind === 'editing')
                deleteTemplate(selection.template);
            }}
          >
            {t('create.taskTemplateDelete')}
          </Button>
        </Show>
      </Show>
    </div>
  );
}
