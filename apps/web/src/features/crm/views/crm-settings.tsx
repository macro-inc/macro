import type { ItemDragOverlayData } from '@app/components/app/ItemDragAndDrop';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import CheckIcon from '@phosphor/check.svg';
import DotsSixVerticalIcon from '@phosphor/dots-six-vertical.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import TrashIcon from '@phosphor/trash.svg';
import XIcon from '@phosphor/x.svg';
import {
  createSortable,
  maybeTransformStyle,
  SortableProvider,
  useDragDropContext,
  useSortableContext,
} from '@thisbeyond/solid-dnd';
import {
  Button,
  ConfirmDialog,
  cn,
  Dialog,
  Panel,
  ToggleSwitch,
  Tooltip,
} from '@ui';
import {
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../../settings/primitives';
import { CrmStageIcon } from '../components/stage-icon';
import { useCrmContext } from '../context/crm-context';
import { createStageEditor } from '../primitives/stage-editor';
import {
  useCrmPermissions,
  useCurrentTeamQuery,
  useDealStages,
  useIsTeamAdmin,
  usePatchTeamCrmSettingsMutation,
  useReplaceCrmStagesMutation,
  useResetCrmStagesMutation,
  useTeamCrmConfig,
} from './use-crm';

/* ------------------------------------------------------------------ */
/* CRM enablement                                                     */
/* ------------------------------------------------------------------ */

const DISABLE_CRM_PHRASE = 'Disable CRM';

/** Typed confirmation matching the Team tab's Delete Team dialog. */
function DisableCrmDialog(props: {
  open: boolean;
  pending: boolean;
  confirmation: string;
  onConfirmationInput: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
        <Panel.Header class="px-2 gap-1">
          <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
            <XIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
            Disable CRM
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-3 flex flex-col gap-3">
          <p>
            Disabling the CRM{' '}
            <span class="font-medium">permanently purges</span> your team's CRM
            data — companies, contacts, and their history. Re-enabling later
            lets you backfill again or start fresh.
          </p>
          <p class="text-sm text-ink-muted">
            Type <span class="font-medium text-ink">{DISABLE_CRM_PHRASE}</span>{' '}
            to confirm.
          </p>
          <input
            type="text"
            value={props.confirmation}
            onInput={(e) => props.onConfirmationInput(e.currentTarget.value)}
            placeholder={DISABLE_CRM_PHRASE}
            class="settings-input w-full"
          />
          <div class="flex justify-end gap-1 pt-2">
            <Button
              variant="ghost"
              disabled={props.pending}
              onClick={props.onClose}
            >
              Cancel
            </Button>
            <Button
              variant="strong"
              disabled={
                props.pending || props.confirmation !== DISABLE_CRM_PHRASE
              }
              onClick={props.onConfirm}
            >
              <Show when={props.pending} fallback={DISABLE_CRM_PHRASE}>
                <SpinnerIcon class="size-4 animate-spin" />
              </Show>
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

function CrmEnablementSection() {
  const isTeamAdmin = useIsTeamAdmin();
  const teamQuery = useCurrentTeamQuery();
  const patchCrmMutation = usePatchTeamCrmSettingsMutation();

  // The mutation invalidates the team query on success, which refetches
  // the authoritative flag. The switch stays on that flag until a dialog
  // confirms the change.
  const crmEnabled = () => teamQuery.data?.team.crm_enabled ?? false;
  const [showEnableModal, setShowEnableModal] = createSignal(false);
  const [enableChoice, setEnableChoice] = createSignal<'backfill' | 'fresh'>();
  const [showDisableModal, setShowDisableModal] = createSignal(false);
  const [disableConfirmation, setDisableConfirmation] = createSignal('');

  const handleToggle = (next: boolean) => {
    if (!isTeamAdmin() || patchCrmMutation.isPending) return;
    if (next) {
      // Enabling asks whether to backfill from existing email history.
      setShowEnableModal(true);
    } else {
      // Disabling purges the team's CRM data — force a typed confirmation.
      setDisableConfirmation('');
      setShowDisableModal(true);
    }
  };

  const handleEnable = (backfill: boolean) => {
    setEnableChoice(backfill ? 'backfill' : 'fresh');
    patchCrmMutation.mutate(
      { enabled: true, backfill },
      {
        onSuccess: () => setShowEnableModal(false),
        onSettled: () => setEnableChoice(undefined),
      }
    );
  };

  const handleDisable = () => {
    patchCrmMutation.mutate(
      { enabled: false, backfill: false },
      {
        onSuccess: () => setShowDisableModal(false),
      }
    );
  };

  return (
    <SettingsSection title="General">
      <SettingsCard>
        <SettingsRow
          label="Team CRM"
          description={
            isTeamAdmin()
              ? 'Companies, contacts, and pipelines for everyone on your team.'
              : 'Companies, contacts, and pipelines for everyone on your team. Only team admins can turn it on or off.'
          }
        >
          <Show when={patchCrmMutation.isPending}>
            <SpinnerIcon class="size-4 animate-spin text-ink-muted" />
          </Show>
          <ToggleSwitch
            size="md"
            label="Team CRM"
            labelClass="sr-only"
            checked={crmEnabled()}
            disabled={!isTeamAdmin() || patchCrmMutation.isPending}
            onChange={handleToggle}
          />
        </SettingsRow>
      </SettingsCard>

      <Dialog
        open={showEnableModal()}
        onOpenChange={(open) => !open && setShowEnableModal(false)}
      >
        <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
          <Panel.Header class="px-2 gap-1">
            <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
              <XIcon />
            </Dialog.CloseButton>
            <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
              Enable CRM
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="p-3 flex flex-col gap-3">
            <p>
              Start the CRM from your team's existing email, or from a clean
              slate.
            </p>
            <div class="flex justify-end gap-1 pt-2">
              <Button
                variant="ghost"
                disabled={patchCrmMutation.isPending}
                onClick={() => setShowEnableModal(false)}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                disabled={patchCrmMutation.isPending}
                onClick={() => handleEnable(false)}
              >
                <Show
                  when={
                    enableChoice() === 'fresh' && patchCrmMutation.isPending
                  }
                  fallback="Start from now"
                >
                  <SpinnerIcon class="size-4 animate-spin" />
                </Show>
              </Button>
              <Button
                variant="strong"
                disabled={patchCrmMutation.isPending}
                onClick={() => handleEnable(true)}
              >
                <Show
                  when={
                    enableChoice() === 'backfill' && patchCrmMutation.isPending
                  }
                  fallback="Backfill existing emails"
                >
                  <SpinnerIcon class="size-4 animate-spin" />
                </Show>
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>

      <DisableCrmDialog
        open={showDisableModal()}
        pending={patchCrmMutation.isPending}
        confirmation={disableConfirmation()}
        onConfirmationInput={setDisableConfirmation}
        onConfirm={handleDisable}
        onClose={() => setShowDisableModal(false)}
      />
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Stages                                                             */
/* ------------------------------------------------------------------ */

/**
 * Drag data carried by stage row sortables. Distinct from `EntityDragData`
 * so entity drop consumers ignore stage drags. Supplies its own overlay icon.
 */
type StageDragData = ItemDragOverlayData & {
  dragType: 'stage';
  name: string;
};

/**
 * Reordering follows the GOV.UK reorderable list: a drag handle with pointer
 * drag and arrow-key moves on desktop, plain up/down buttons on touch. The
 * pointer sensor in solid-dnd listens to mouse events only, so touch gets the
 * buttons rather than a handle that would fight the page scroll.
 */
function useStageReorderMode(): 'drag' | 'buttons' {
  const canDrag =
    useDragDropContext() !== null && useSortableContext() !== null;
  return canDrag && !isTouchDevice() ? 'drag' : 'buttons';
}

/** Wraps the rows in a sortable context when the app-wide drag provider is present. */
function StageList(props: { ids: string[]; children: JSX.Element }) {
  const dnd = useDragDropContext();
  return (
    <Show when={dnd !== null} fallback={props.children}>
      <SortableProvider ids={props.ids}>{props.children}</SortableProvider>
    </Show>
  );
}

/** Same colored icon the CRM list groups and filters show for a stage. */
function StageIcon(props: { id: string; index: number }) {
  return (
    <CrmStageIcon optionId={props.id} index={props.index} class="size-3.5" />
  );
}

function StageRow(props: { id: string; label: string; index: number }) {
  return (
    <div class="flex min-h-12 items-center gap-3 px-4 py-3">
      <StageIcon id={props.id} index={props.index} />
      <span class="min-w-0 truncate text-sm text-ink">{props.label}</span>
    </div>
  );
}

/** Reads as plain text until hovered or focused, so the list stays a list. */
function InlineStageInput(props: {
  value: string;
  placeholder: string;
  label: string;
  onInput: (value: string) => void;
  onKeyDown: (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => void;
}) {
  return (
    <input
      type="text"
      value={props.value}
      aria-label={props.label}
      placeholder={props.placeholder}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      onKeyDown={(e) => props.onKeyDown(e)}
      class="-mx-2 h-8 min-w-0 flex-1 truncate rounded-md bg-transparent px-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-placeholder not-touch:hover:bg-hover focus:bg-control focus-visible:ring-2 focus-visible:ring-edge-muted"
    />
  );
}

function StageEditorRow(props: {
  id: string;
  label: string;
  draft: string | undefined;
  index: number;
  count: number;
  pending: boolean;
  onDraft: (value: string | undefined) => void;
  onRename: (value: string) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const value = () => props.draft ?? props.label;
  const hasChanged = () => {
    const edited = props.draft;
    return (
      edited !== undefined &&
      edited.trim() !== '' &&
      edited.trim() !== props.label
    );
  };
  const commit = () => {
    if (!hasChanged() || props.pending) return;
    props.onRename(value().trim());
  };
  const cancel = () => props.onDraft(undefined);
  const isEditing = () => props.draft !== undefined;
  const isLastStage = () => props.count <= 1;
  const isFirst = () => props.index === 0;
  const isLast = () => props.index === props.count - 1;

  const reorderMode = useStageReorderMode();
  const [dndState] = useDragDropContext() ?? [];
  const sortable =
    reorderMode === 'drag'
      ? createSortable(props.id, {
          dragType: 'stage',
          overlayIcon: () => <StageIcon id={props.id} index={props.index} />,
          get name() {
            return props.label;
          },
        } satisfies StageDragData)
      : undefined;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (props.pending) return;
    if (e.key === 'ArrowUp' && !isFirst()) props.onMove(-1);
    if (e.key === 'ArrowDown' && !isLast()) props.onMove(1);
  };

  return (
    <div
      ref={sortable?.ref}
      style={sortable ? maybeTransformStyle(sortable.transform) : undefined}
      class={cn(
        'flex min-h-12 items-center gap-3 px-4 py-2',
        // Shift rows out of the way while a drag is live; snap when it ends
        // so the settled order doesn't animate twice.
        !!dndState?.active.draggable && 'transition-transform',
        sortable?.isActiveDraggable && 'opacity-40'
      )}
    >
      <Show when={sortable}>
        <Tooltip label="Drag to reorder, or use the arrow keys">
          <Button
            {...(sortable?.dragActivators ?? {})}
            aria-label={`Reorder ${props.label}. Press the up or down arrow keys to move it.`}
            variant="ghost"
            size="icon-sm"
            class="-mx-1.5 cursor-grab touch-none text-ink-extra-muted active:cursor-grabbing"
            onKeyDown={handleKeyDown}
          >
            <DotsSixVerticalIcon class="size-4" />
          </Button>
        </Tooltip>
      </Show>
      <StageIcon id={props.id} index={props.index} />
      <InlineStageInput
        value={value()}
        label={`Rename ${props.label}`}
        placeholder="Stage name"
        onInput={(next) => props.onDraft(next)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
          } else if (e.key === 'Escape') {
            cancel();
            e.currentTarget.blur();
          }
        }}
      />
      <div class="flex shrink-0 items-center gap-0.5">
        <Show when={isEditing()}>
          <Tooltip label="Save">
            <Button
              aria-label="Save stage name"
              variant="accent"
              size="icon-sm"
              disabled={props.pending || !hasChanged()}
              onClick={commit}
            >
              <Show
                when={props.pending}
                fallback={<CheckIcon class="size-4" />}
              >
                <SpinnerIcon class="size-4 animate-spin" />
              </Show>
            </Button>
          </Tooltip>
          <Tooltip label="Cancel">
            <Button
              aria-label="Cancel rename"
              variant="ghost"
              size="icon-sm"
              disabled={props.pending}
              onClick={cancel}
            >
              <XIcon class="size-4" />
            </Button>
          </Tooltip>
        </Show>
        <Show when={reorderMode === 'buttons'}>
          <Tooltip label="Move up">
            <Button
              aria-label={`Move ${props.label} up`}
              variant="ghost"
              size="icon-sm"
              disabled={props.pending || isFirst()}
              onClick={() => props.onMove(-1)}
            >
              <CaretUpIcon class="size-4" />
            </Button>
          </Tooltip>
          <Tooltip label="Move down">
            <Button
              aria-label={`Move ${props.label} down`}
              variant="ghost"
              size="icon-sm"
              disabled={props.pending || isLast()}
              onClick={() => props.onMove(1)}
            >
              <CaretDownIcon class="size-4" />
            </Button>
          </Tooltip>
        </Show>
        <Tooltip
          label={
            isLastStage() ? 'At least one stage is required' : 'Delete stage'
          }
        >
          <Button
            aria-label={`Delete ${props.label}`}
            variant="ghost"
            size="icon-sm"
            class="text-ink-extra-muted not-touch:hover:text-failure"
            disabled={props.pending || isLastStage()}
            onClick={() => props.onDelete()}
          >
            <TrashIcon class="size-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

function StagesSection() {
  const dealStages = useDealStages();
  const crmPermissions = useCrmPermissions();
  const teamCrmConfig = useTeamCrmConfig();
  const replaceMutation = useReplaceCrmStagesMutation();
  const resetMutation = useResetCrmStagesMutation();

  const {
    newStageName,
    setNewStageName,
    stageToDelete,
    setStageToDelete,
    showResetModal,
    setShowResetModal,
    canEdit,
    pending,
    loading,
    failed,
    blocked,
    drafts,
    setDrafts,
    orderedStages,
    stageIds,
    announcement,
    handleCustomize,
    handleRename,
    reorder,
    handleMove,
    handleAddStage,
    handleDeleteStage,
    handleReset,
  } = createStageEditor({
    dealStages,
    crmPermissions,
    teamCrmConfig,
    replaceMutation,
    resetMutation,
    onSuccess: useCrmContext().feedback.success,
  });

  // Settings render inside the app-wide DragDropProvider (ItemDndProvider);
  // register on its events rather than mounting a nested provider.
  const [, dndActions] = useDragDropContext() ?? [];
  dndActions?.onDragEnd(({ draggable, droppable }) => {
    if (draggable.data.dragType !== 'stage') return;
    // Dropping outside the list leaves the order unchanged.
    if (!droppable || droppable.data.dragType !== 'stage') return;
    const ids = stageIds();
    reorder(
      ids.indexOf(String(draggable.id)),
      ids.indexOf(String(droppable.id))
    );
  });

  const editing = () => dealStages.isCustomized() && canEdit();
  const description = () => {
    const scope =
      'The Stage options on companies. New pipelines start with these stages.';
    if (loading() || canEdit()) return scope;
    return crmPermissions.permissions().editStages === 'owner'
      ? `${scope} Only the team owner can change them.`
      : `${scope} Only team admins can change them.`;
  };

  return (
    <SettingsSection
      title="Stages"
      description={description()}
      actions={
        <Show when={canEdit() && !loading() && !failed()}>
          <Show
            when={dealStages.isCustomized()}
            fallback={
              <Button
                variant="outline"
                size="sm"
                disabled={pending()}
                onClick={handleCustomize}
              >
                <Show when={pending()} fallback="Customize">
                  <SpinnerIcon class="size-4 animate-spin" />
                </Show>
              </Button>
            }
          >
            <Button
              variant="outline"
              size="sm"
              disabled={blocked()}
              onClick={() => setShowResetModal(true)}
            >
              Reset to defaults
            </Button>
          </Show>
        </Show>
      }
    >
      <SettingsCard>
        <Switch>
          <Match when={failed()}>
            <div class="px-4 py-4 text-sm text-ink-muted">
              Stages could not be loaded. Reload to try again.
            </div>
          </Match>
          <Match when={loading()}>
            <div class="px-4 py-4">
              <ListSkeleton.Bar class="h-4 w-32" />
            </div>
          </Match>
          <Match when={editing()}>
            <StageList ids={stageIds()}>
              <For each={orderedStages()}>
                {(stage, index) => (
                  <StageEditorRow
                    id={stage.id}
                    label={stage.label}
                    draft={drafts[stage.id]}
                    index={index()}
                    count={orderedStages().length}
                    pending={pending()}
                    onDraft={(value) => setDrafts(stage.id, value)}
                    onRename={(label) => handleRename(index(), label)}
                    onMove={(direction) => handleMove(index(), direction)}
                    onDelete={() => setStageToDelete(stage)}
                  />
                )}
              </For>
            </StageList>
            <div class="flex min-h-12 items-center gap-3 px-4 py-2">
              <PlusIcon class="size-3.5 shrink-0 text-ink-muted" />
              <InlineStageInput
                value={newStageName()}
                label="New stage name"
                placeholder="Add stage"
                onInput={setNewStageName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddStage();
                }}
              />
              <Button
                variant="outline"
                size="sm"
                class="shrink-0"
                disabled={newStageName().trim() === '' || pending()}
                onClick={handleAddStage}
              >
                Add
              </Button>
            </div>
          </Match>
          <Match when={true}>
            <For each={dealStages.stages()}>
              {(stage, index) => (
                <StageRow id={stage.id} label={stage.label} index={index()} />
              )}
            </For>
          </Match>
        </Switch>
      </SettingsCard>
      <div aria-live="polite" class="sr-only">
        {announcement()}
      </div>

      <ConfirmDialog
        open={!!stageToDelete()}
        onOpenChange={(open) => !open && setStageToDelete(null)}
        title="Delete stage"
        tone="danger"
        confirmLabel="Delete"
        pending={replaceMutation.isPending}
        onConfirm={handleDeleteStage}
        body={
          <>
            Companies at{' '}
            <span class="font-medium text-ink">
              {stageToDelete()?.label ?? ''}
            </span>{' '}
            lose their stage and show under No stage. Pipelines keep their own
            stages.
          </>
        }
      />

      <ConfirmDialog
        open={showResetModal()}
        onOpenChange={setShowResetModal}
        title="Reset stages"
        tone="danger"
        confirmLabel="Reset to defaults"
        pending={resetMutation.isPending}
        onConfirm={handleReset}
        body={
          <>
            Your team returns to Macro's default stages. Companies keep their
            stored stage values, and stages whose names match a default display
            as before.
          </>
        }
      />
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

function NoTeamState() {
  return (
    <SettingsPage title="CRM">
      <SettingsSection>
        <SettingsCard>
          <div class="px-6 py-8 text-center text-sm text-ink-muted">
            Join or create a team to set up the CRM.
          </div>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}

function CrmContent() {
  const teamQuery = useCurrentTeamQuery();

  return (
    <Show when={teamQuery.data} fallback={<NoTeamState />}>
      <SettingsPage
        title="CRM"
        description="Turn your team's CRM on or off and choose its stages."
      >
        <CrmEnablementSection />
        <Show when={teamQuery.data?.team.crm_enabled}>
          <StagesSection />
        </Show>
      </SettingsPage>
    </Show>
  );
}

export function Crm() {
  return (
    <Suspense fallback={<ListSkeleton.Bar class="m-6 h-4 w-32" />}>
      <CrmContent />
    </Suspense>
  );
}
