import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { onElementConnect } from '@core/util/onElementConnect';
import { thrownResultErrorHasCode } from '@core/util/result';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import FileIcon from '@icon/system/regular/file.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import type { TaskTemplate } from '@service-storage/generated/schemas/taskTemplate';
import {
  Avatar,
  Button,
  ConfirmDialog,
  Dropdown,
  InputGroup,
  type ManagedDialogProps,
  openDialog,
  Tooltip,
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
    if (selection.kind === 'none') return t('create.taskTemplateNone');
    if (selection.kind === 'new' || selection.kind === 'editing')
      return selection.name || t('create.taskTemplates');
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
              <Show
                when={selectedKey() === 'none'}
                fallback={<CopyIcon class="size-4 shrink-0" />}
              >
                <FileIcon class="size-4 shrink-0" />
              </Show>
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
          class="shrink-0 gap-1"
          disabled={props.composer.isSavingTemplate()}
          onClick={props.composer.cancelTemplateEdit}
        >
          <CaretLeftIcon class="size-4 shrink-0" />
          {props.composer.templateSelection().kind === 'new'
            ? t('create.taskTemplateNew')
            : t('create.taskTemplateEdit')}
        </Button>
        <Show
          when={
            props.composer.templateSelection().kind === 'editing' &&
            selectedCanManage()
          }
        >
          <Button
            variant="secondary"
            size={isTouchDevice() ? 'icon-sm' : 'xs'}
            aria-label={t('create.taskTemplateDelete')}
            tooltip={t('create.taskTemplateDelete')}
            disabled={props.composer.isSavingTemplate()}
            onClick={() => {
              const selection = props.composer.templateSelection();
              if (selection.kind === 'editing')
                deleteTemplate(selection.template);
            }}
          >
            <Show
              when={isTouchDevice()}
              fallback={t('create.taskTemplateDelete')}
            >
              <TrashIcon class="size-4 shrink-0" />
            </Show>
          </Button>
        </Show>
      </Show>
    </div>
  );
}

/** Template identity and immutable ownership, separate from the task defaults. */
export function TaskTemplateNameStrip(props: {
  composer: TaskComposerController;
}) {
  const selection = () => props.composer.templateSelection();
  const name = () => {
    const current = selection();
    return current.kind === 'new' || current.kind === 'editing'
      ? current.name
      : '';
  };
  const teamId = () => {
    const current = selection();
    if (current.kind === 'new') return current.teamId;
    if (current.kind === 'editing') return current.template.teamId;
    return null;
  };
  const teamName = () =>
    props.composer.team()?.name ?? t('create.taskTemplateTeam');
  const visibilityLabel = () =>
    teamId() ? teamName() : t('create.taskTemplateOnlyMe');
  const teamIdentity = () => (
    <>
      <Avatar size="sm" shape="square">
        <Avatar.Fallback>
          {teamName().slice(0, 1).toUpperCase()}
        </Avatar.Fallback>
      </Avatar>
      <span class="min-w-0 truncate">{teamName()}</span>
    </>
  );
  return (
    <Show when={props.composer.isTemplateMode()}>
      <InputGroup
        size="xl"
        class="mb-4 shrink-0 mobile:h-auto mobile:flex-wrap"
      >
        <InputGroup.Input
          ref={(input) =>
            onElementConnect(input, () => {
              if (selection().kind === 'new') input.focus();
            })
          }
          class="ph-no-capture truncate font-semibold mobile:py-3"
          aria-label={t('create.taskTemplateName')}
          placeholder={t('create.taskTemplateNamePlaceholder')}
          autocomplete="off"
          data-1p-ignore
          value={name()}
          disabled={props.composer.isSavingTemplate()}
          onInput={(event) =>
            props.composer.setTemplateName(event.currentTarget.value)
          }
        />
        <InputGroup.Addon>
          <CopyIcon class="size-4" />
        </InputGroup.Addon>
        <Show when={selection().kind === 'new' || teamId()}>
          <InputGroup.Addon
            align="inline-end"
            class="min-w-0 max-w-1/2 mobile:max-w-full mobile:basis-full mobile:justify-start mobile:pb-3 mobile:ps-4"
          >
            <Show
              when={selection().kind === 'new'}
              fallback={
                <Tooltip
                  label={teamName()}
                  class="min-w-0 flex items-center gap-2 text-xs"
                >
                  {teamIdentity()}
                </Tooltip>
              }
            >
              <Dropdown>
                <Dropdown.Trigger
                  variant="secondary"
                  size="xs"
                  class="min-w-0 max-w-full"
                  disabled={props.composer.isSavingTemplate()}
                  aria-label={t('create.taskTemplateVisibility')}
                  tooltip={visibilityLabel()}
                >
                  <Show
                    when={teamId()}
                    fallback={
                      <>
                        <LockIcon class="size-4 shrink-0" />
                        <span>{t('create.taskTemplateOnlyMe')}</span>
                      </>
                    }
                  >
                    {teamIdentity()}
                  </Show>
                  <CaretDownIcon class="size-4 shrink-0" />
                </Dropdown.Trigger>
                <Dropdown.Content>
                  <Dropdown.Group>
                    <Dropdown.RadioGroup
                      value={teamId() ?? ''}
                      onChange={(id) =>
                        props.composer.setTemplateTeamId(id || null)
                      }
                    >
                      <Dropdown.RadioItem value="">
                        <LockIcon class="size-4 shrink-0" />
                        <span>{t('create.taskTemplateOnlyMe')}</span>
                        <Dropdown.ItemIndicator />
                      </Dropdown.RadioItem>
                      <Show when={props.composer.team()}>
                        {(team) => (
                          <Dropdown.RadioItem value={team().id}>
                            {teamIdentity()}
                            <Dropdown.ItemIndicator />
                          </Dropdown.RadioItem>
                        )}
                      </Show>
                    </Dropdown.RadioGroup>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            </Show>
          </InputGroup.Addon>
        </Show>
      </InputGroup>
    </Show>
  );
}
