import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { onElementConnect } from '@core/util/onElementConnect';
import { thrownResultErrorHasCode } from '@core/util/result';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import FileIcon from '@icon/system/regular/file.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import type { TaskTemplate } from '@service-storage/generated/schemas/taskTemplate';
import {
  Avatar,
  Button,
  ConfirmDialog,
  cn,
  Input,
  type ManagedDialogProps,
  openDialog,
  ToggleSwitch,
  Tooltip,
  useImperativeDialog,
} from '@ui';
import { inputOutlineFocusClasses } from '@ui/components/Input';
import {
  type Accessor,
  type ComponentProps,
  createMemo,
  createSignal,
  getOwner,
  Show,
} from 'solid-js';
import type { TaskComposerController } from '../../task-composer/primitives/task-composer';
import {
  TemplateDropdown,
  TemplatePicker,
} from '../components/template-picker';
import {
  createTemplateControls,
  createTemplateDeletion,
  createTemplateDialogLifetime,
  type TemplateDialogScope,
} from '../primitives/template-controls';
import { taskTemplateForComposer } from '../queries/template-mapping';
import {
  useDeleteTaskTemplate,
  useTaskTemplatesQuery,
} from '../queries/templates';

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

function ScopedTemplatePicker(
  props: DialogScope & ComponentProps<typeof TemplatePicker>
) {
  createTemplateDialogLifetime(props, () => props.onOpenChange(false));
  return <TemplatePicker {...props} />;
}

/** Selection belongs to the composer, not the picker presentation lifetime. */
export function TaskTemplateControls(props: {
  composer: TaskComposerController;
  compact?: boolean;
}) {
  const viewerId = useUserId();
  // A new scope gets a fresh picker lifetime instead of syncing open state in an effect.
  const scope = () =>
    [
      viewerId(),
      props.composer.team()?.id,
      props.composer.templatesEnabled(),
      props.composer.isCreating(),
    ].join(':');
  return (
    <Show when={scope()} keyed>
      {(_scope) => (
        <ScopedTaskTemplateControls {...props} viewerId={viewerId} />
      )}
    </Show>
  );
}

function ScopedTaskTemplateControls(props: {
  composer: TaskComposerController;
  compact?: boolean;
  viewerId: Accessor<string | undefined>;
}) {
  const owner = getOwner();
  const picker = useImperativeDialog(ScopedTemplatePicker);
  const [dropdownOpen, setDropdownOpen] = createSignal(false);
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
      (dropdownOpen() ||
        picker.isOpen() ||
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
  const openPicker = () => {
    if (controls.canUse())
      picker.open(() => ({ ...controls.scope, ...pickerProps() }));
  };
  const changeDropdownOpen = (open: boolean) => {
    if (open && !controls.canUse()) return;
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
                disabled={
                  !controls.canUse() || !props.composer.definitionsReady()
                }
              />
            }
          >
            <Button
              variant="secondary"
              size={props.compact ? 'icon-sm' : 'sm'}
              aria-label={t('create.taskTemplateSelected', {
                name: controls.selectedLabel(),
              })}
              disabled={
                !controls.canUse() || !props.composer.definitionsReady()
              }
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openPicker}
            >
              <Show
                when={controls.selectedKey() === 'none'}
                fallback={<CopyIcon class="size-4 shrink-0" />}
              >
                <FileIcon class="size-4 shrink-0" />
              </Show>
              <Show when={!props.compact}>{controls.selectedLabel()}</Show>
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
            controls.selectedCanManage()
          }
        >
          <Button
            variant="secondary"
            size={isTouchDevice() ? 'icon-sm' : 'xs'}
            aria-label={t('create.taskTemplateDelete')}
            tooltip={t('create.taskTemplateDelete')}
            disabled={props.composer.isSavingTemplate()}
            onClick={controls.remove}
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
  composer: Pick<
    TaskComposerController,
    | 'templateSelection'
    | 'team'
    | 'isTemplateMode'
    | 'isSavingTemplate'
    | 'setTemplateName'
    | 'setTemplateTeamId'
  >;
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
      <div class="mb-4 flex min-w-0 shrink-0 items-center gap-3 mobile:flex-wrap">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <CopyIcon class="size-4 shrink-0 text-ink-muted" />
          <Input
            variant="bare"
            size="lg"
            ref={(input) =>
              onElementConnect(input, () => {
                if (selection().kind === 'new') input.focus();
              })
            }
            class={cn(
              'ph-no-capture truncate px-0 font-semibold',
              inputOutlineFocusClasses
            )}
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
        </div>
        <Show
          when={
            (selection().kind === 'new' && props.composer.team()) || teamId()
          }
        >
          <div class="flex min-w-0 max-w-1/2 shrink-0 items-center mobile:max-w-full mobile:basis-full">
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
              <Show when={props.composer.team()}>
                {(team) => (
                  <ToggleSwitch
                    checked={Boolean(teamId())}
                    onChange={(checked) =>
                      props.composer.setTemplateTeamId(
                        checked ? team().id : null
                      )
                    }
                    disabled={props.composer.isSavingTemplate()}
                    label={t('create.taskTemplateShareVisibility')}
                    labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
                  />
                )}
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
