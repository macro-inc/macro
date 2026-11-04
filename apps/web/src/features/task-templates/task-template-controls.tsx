import { t } from '@app/lib/i18n';
import { TaskComposerPropertyEditor } from '@block-md/component/TaskComposerPropertyEditor';
import { createTaskComposerProperties } from '@block-md/util/taskComposerProperties';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import CopyIcon from '@icon/system/regular/copy.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Property } from '@property';
import { PropertyValuePill } from '@property/component/PropertyValuePill';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { TaskTemplate } from '@service-storage/generated/schemas/taskTemplate';
import { Key } from '@solid-primitives/keyed';
import {
  Button,
  ConfirmDialog,
  Dialog,
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
import { unwrap } from 'solid-js/store';
import type { TaskComposerController } from '../task-composer/primitives/task-composer';
import { TemplateForm } from './components/template-form';
import { TemplateDropdown, TemplatePicker } from './components/template-picker';
import {
  captureTaskTemplate,
  type TaskTemplateContents,
} from './core/template';
import {
  taskTemplateConfiguration,
  taskTemplateContents,
} from './queries/template-mapping';
import {
  useCreateTaskTemplate,
  useDeleteTaskTemplate,
  useTaskTemplatesQuery,
  useUpdateTaskTemplate,
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

function mutationError(error: unknown, fallback: string) {
  if (error === undefined) return undefined;
  return thrownResultErrorHasCode(error, 'CONFLICT')
    ? t('create.taskTemplateConflict')
    : fallback;
}

function TemplateEditorDialog(
  props: DialogScope & {
    initial: TaskTemplateContents;
    template?: TaskTemplate;
    team?: { id: string; name: string };
  }
) {
  const lifetime = dialogLifetime(props);
  const initialValues = structuredClone(props.initial.propertyDefaults);
  const fields = createTaskComposerProperties({
    initialValues,
    initialVisiblePropertyIds: [...props.initial.propertyIds],
    allDefinitions: true,
  });
  const [description, setDescription] = createSignal(
    props.initial.descriptionMarkdown
  );
  const [failure, setFailure] = createSignal<unknown>();
  const create = useCreateTaskTemplate();
  const update = useUpdateTaskTemplate();
  const pending = () => create.isPending || update.isPending;
  const save = async (name: string, teamId: string | null) => {
    if (!lifetime.current() || !lifetime.viewer || pending()) return;
    const definitions = fields.availableProperties();
    if (definitions.length === 0) return;
    const contents = captureTaskTemplate(
      {
        propertyIds: fields
          .properties()
          .map((property) => property.propertyDefinitionId),
        propertyDefaults: structuredClone(unwrap(fields.propertyValues)),
        descriptionMarkdown: description(),
      },
      new Set(definitions.map((definition) => definition.id)),
      new Set<string>()
    );
    const configuration = taskTemplateConfiguration(
      contents,
      definitions,
      props.template?.configuration
    );
    setFailure(undefined);
    try {
      if (props.template) {
        await update.mutateAsync({
          viewerId: lifetime.viewer,
          id: props.template.id,
          body: { name, configuration, revision: props.template.revision },
        });
      } else {
        await create.mutateAsync({
          viewerId: lifetime.viewer,
          body: { name, configuration, teamId },
        });
      }
      if (lifetime.current()) {
        props.onOpenChange(false);
        toast.success(t('create.taskTemplateSaved'));
      }
    } catch (error) {
      if (lifetime.current()) setFailure(error);
    }
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!pending()) props.onOpenChange(open);
      }}
      position="center"
      class="w-150 max-w-[calc(100vw-2rem)]"
    >
      <TemplateForm
        {...props}
        name={props.template?.name ?? ''}
        editing={Boolean(props.template)}
        shared={Boolean(props.template?.teamId)}
        pending={pending()}
        canSave={fields.availableProperties().length > 0}
        error={mutationError(failure(), t('create.taskTemplateSaveError'))}
        descriptionMarkdown={description()}
        onDescriptionChange={setDescription}
        onSave={(name, teamId) =>
          fireAndForget(save(name, teamId), 'task-templates')
        }
        properties={
          <PropertiesProvider
            entityType="TASK"
            canEdit={!pending()}
            properties={fields.properties}
            saveHandler={fields.saveHandler}
            onRefresh={() => {}}
            onPropertyAdded={() => {}}
            onPropertyDeleted={() => {}}
          >
            <div class="flex flex-wrap items-center gap-2">
              <Key each={fields.properties()} by="propertyDefinitionId">
                {(property) => (
                  <div class="flex min-w-0 items-center gap-0.5">
                    <PropertyValuePill
                      property={property()}
                      canEdit={!pending()}
                      onSave={fields.saveHandler.saveProperty}
                      editor={
                        isTouchDevice()
                          ? Property.SheetEditor
                          : Property.PopoverEditor
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('create.taskTemplateRemoveProperty', {
                        name: property().displayName,
                      })}
                      disabled={pending()}
                      onClick={() =>
                        fields.setVisiblePropertyIds((ids) =>
                          ids.filter(
                            (id) => id !== property().propertyDefinitionId
                          )
                        )
                      }
                    >
                      <XIcon class="size-3" />
                    </Button>
                  </div>
                )}
              </Key>
              <TaskComposerPropertyEditor
                name={props.template?.name ?? t('create.taskTemplateSaveTitle')}
                definitions={fields.availableProperties()}
                properties={fields.properties()}
                onAdd={fields.addProperty}
                onSave={(id, value) => fields.setPropertyValues(id, value)}
              />
            </div>
          </PropertiesProvider>
        }
      />
    </Dialog>
  );
}

function DeleteTemplateDialog(props: DialogScope & { template: TaskTemplate }) {
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
      if (lifetime.current()) props.onOpenChange(false);
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
          <p role="alert" class="text-failure-ink">
            {mutationError(failure(), t('create.taskTemplateDeleteError'))}
          </p>
        </div>
      }
      confirmLabel={t('create.taskTemplateDelete')}
      tone="danger"
      pending={mutation.isPending}
      onConfirm={() => fireAndForget(remove(), 'task-templates')}
    />
  );
}

function ScopedTemplatePicker(
  props: DialogScope & ComponentProps<typeof TemplatePicker>
) {
  dialogLifetime(props);
  return <TemplatePicker {...props} />;
}

/** App-facing composition; templates never replace a populated composer field. */
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
  const openEditor = (template?: TaskTemplate) => {
    if (!isCurrent()) return;
    const definitions = props.composer.availableProperties();
    const initial = template
      ? taskTemplateContents(template.configuration, definitions)
      : captureTaskTemplate(
          props.composer.templateContents(),
          new Set(definitions.map((definition) => definition.id)),
          new Set([SYSTEM_PROPERTY_IDS.SOURCE])
        );
    openDialog(
      TemplateEditorDialog,
      { initial, template, team: team(), viewerId, isCurrent },
      { owner }
    );
  };
  const pickerProps = () => ({
    loading: query.isPending,
    error: query.isError,
    items: (query.isSuccess ? query.data : []).map((template) => ({
      key: template.id,
      label: template.name,
      shared: Boolean(template.teamId),
      select: () => {
        if (!isCurrent()) return;
        const definitions = props.composer.availableProperties();
        const available = new Set(
          definitions.map((definition) => definition.id)
        );
        props.composer.applyTemplate(
          taskTemplateContents(template.configuration, definitions)
        );
        if (
          template.configuration.propertyIds.some((id) => !available.has(id))
        ) {
          toast.alert(t('create.taskTemplateUnavailableProperties'));
        }
      },
      edit: template.canManage ? () => openEditor(template) : undefined,
      remove: template.canManage
        ? () => {
            if (!isCurrent()) return;
            openDialog(
              DeleteTemplateDialog,
              { template, viewerId, isCurrent },
              { owner }
            );
          }
        : undefined,
    })),
    onRetry: () => fireAndForget(query.refetch(), 'task-templates'),
    onSave: () => openEditor(),
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
        aria-label={t('create.taskTemplates')}
        tooltip={props.compact ? t('create.taskTemplates') : undefined}
        disabled={
          !canUse() || props.composer.availableProperties().length === 0
        }
        onClick={openPicker}
      >
        <CopyIcon class="size-4 shrink-0" />
        <Show when={!props.compact}>{t('create.taskTemplates')}</Show>
      </Button>
    </Show>
  );
}
