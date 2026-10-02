import type { ItemDragOverlayData } from '@app/components/app/ItemDragAndDrop';
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
import { Button, Checkbox, cn, Dialog, Panel, Tooltip } from '@ui';
import { createSignal, For, type JSX, Show, Suspense } from 'solid-js';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../../settings/primitives';
import { CrmStageDot as StageDot } from '../components/stage-icon';
import { useCrmContext } from '../context/crm-context';
import { createStageEditor } from '../primitives/stage-editor';
import {
  useClosedStageIds,
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
/* Shared bits                                                        */
/* ------------------------------------------------------------------ */

/** Confirm dialog matching the Team tab's destructive-action dialogs. */
function ConfirmDialog(props: {
  open: boolean;
  title: string;
  confirmLabel: string;
  pending?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: JSX.Element;
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
        <Panel.Header class="px-2 gap-1">
          <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
            <XIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
            {props.title}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-3 flex flex-col gap-3">
          {props.children}
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
              disabled={props.pending || props.confirmDisabled}
              onClick={props.onConfirm}
            >
              <Show when={props.pending} fallback={props.confirmLabel}>
                <SpinnerIcon class="size-4 animate-spin" />
              </Show>
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* CRM enablement                                                     */
/* ------------------------------------------------------------------ */

const DISABLE_CRM_PHRASE = 'Disable CRM';

function CrmEnablementSection() {
  const isTeamAdmin = useIsTeamAdmin();
  const teamQuery = useCurrentTeamQuery();
  const patchCrmMutation = usePatchTeamCrmSettingsMutation();

  // The mutation invalidates the team query on success, which refetches
  // the authoritative flag.
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
          label={crmEnabled() ? 'Disable CRM' : 'Enable CRM'}
          description={`Turn the CRM ${crmEnabled() ? 'off' : 'on'} for everyone on your team.`}
          hideDescriptionOnMobile
        >
          <Show
            when={isTeamAdmin()}
            fallback={
              <Tooltip label="Only team admins can change CRM settings.">
                <span>
                  <Button variant="outline" size="sm" disabled>
                    Admins only
                  </Button>
                </span>
              </Tooltip>
            }
          >
            <div class="flex items-center gap-2">
              <Show when={patchCrmMutation.isPending}>
                <SpinnerIcon class="size-4 animate-spin text-ink-muted" />
              </Show>
              <Button
                variant={crmEnabled() ? 'danger' : 'accent'}
                size="sm"
                disabled={patchCrmMutation.isPending}
                onClick={() => handleToggle(!crmEnabled())}
              >
                {crmEnabled() ? 'Disable CRM' : 'Enable CRM'}
              </Button>
            </div>
          </Show>
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

      <ConfirmDialog
        open={showDisableModal()}
        title="Disable CRM"
        confirmLabel="Disable CRM"
        pending={patchCrmMutation.isPending}
        confirmDisabled={disableConfirmation() !== DISABLE_CRM_PHRASE}
        onConfirm={handleDisable}
        onClose={() => setShowDisableModal(false)}
      >
        <p>
          Disabling the CRM <span class="font-medium">permanently purges</span>{' '}
          your team's CRM data — companies, contacts, and their history.
          Re-enabling later lets you backfill again or start fresh.
        </p>
        <p class="text-sm text-ink-muted">
          Type <span class="font-medium text-ink">{DISABLE_CRM_PHRASE}</span> to
          confirm.
        </p>
        <input
          type="text"
          value={disableConfirmation()}
          onInput={(e) => setDisableConfirmation(e.currentTarget.value)}
          placeholder={DISABLE_CRM_PHRASE}
          class="settings-input w-full"
        />
      </ConfirmDialog>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Deal stages                                                        */
/* ------------------------------------------------------------------ */

/**
 * Drag data carried by stage row sortables. Distinct from `EntityDragData`
 * so entity drop consumers ignore stage drags. Supplies its own overlay icon.
 */
export type StageDragData = ItemDragOverlayData & {
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

function StageEditorRow(props: {
  id: string;
  label: string;
  draft: string | undefined;
  index: number;
  count: number;
  disabled: boolean;
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
  const canMove = () => !props.disabled && !props.pending;

  const reorderMode = useStageReorderMode();
  const [dndState] = useDragDropContext() ?? [];
  const sortable =
    reorderMode === 'drag'
      ? createSortable(props.id, {
          dragType: 'stage',
          overlayIcon: StageDot,
          get name() {
            return props.label;
          },
        } satisfies StageDragData)
      : undefined;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (!canMove()) return;
    if (e.key === 'ArrowUp' && !isFirst()) props.onMove(-1);
    if (e.key === 'ArrowDown' && !isLast()) props.onMove(1);
  };

  return (
    <div
      ref={sortable?.ref}
      style={sortable ? maybeTransformStyle(sortable.transform) : undefined}
      class={cn(
        'flex items-center gap-2 px-6 py-2.5',
        // Shift rows out of the way while a drag is live; snap when it ends
        // so the settled order doesn't animate twice.
        !!dndState?.active.draggable && 'transition-transform',
        sortable?.isActiveDraggable && 'opacity-40'
      )}
    >
      <Show when={sortable && !props.disabled} fallback={<StageDot />}>
        <Tooltip label="Drag to reorder, or use the arrow keys">
          <Button
            {...(sortable?.dragActivators ?? {})}
            aria-label={`Reorder ${props.label}. Press the up or down arrow keys to move it.`}
            variant="ghost"
            size="icon-sm"
            class="-ml-1.5 cursor-grab touch-none active:cursor-grabbing"
            onKeyDown={handleKeyDown}
          >
            <DotsSixVerticalIcon class="size-4" />
          </Button>
        </Tooltip>
      </Show>
      <input
        type="text"
        value={value()}
        disabled={props.disabled}
        onInput={(e) => props.onDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
          } else if (e.key === 'Escape') {
            cancel();
            e.currentTarget.blur();
          }
        }}
        placeholder="Stage name"
        class="settings-input flex-1 min-w-0"
      />
      <Show when={isEditing()}>
        <Tooltip label="Save">
          <Button
            aria-label="Save stage name"
            variant="accent"
            size="icon-sm"
            class="shrink-0"
            disabled={props.pending || !hasChanged()}
            onClick={commit}
          >
            <Show when={props.pending} fallback={<CheckIcon class="size-4" />}>
              <SpinnerIcon class="size-4 animate-spin" />
            </Show>
          </Button>
        </Tooltip>
        <Tooltip label="Cancel">
          <Button
            aria-label="Cancel rename"
            variant="ghost"
            size="icon-sm"
            class="shrink-0"
            disabled={props.pending}
            onClick={cancel}
          >
            <XIcon class="size-4" />
          </Button>
        </Tooltip>
      </Show>
      <div class="flex items-center gap-0.5 shrink-0">
        <Show when={reorderMode === 'buttons'}>
          <Tooltip label="Move up">
            <Button
              aria-label={`Move ${props.label} up`}
              variant="ghost"
              size="icon-sm"
              disabled={!canMove() || isFirst()}
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
              disabled={!canMove() || isLast()}
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
            disabled={props.disabled || props.pending || isLastStage()}
            onClick={() => props.onDelete()}
          >
            <TrashIcon class="size-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

function DealStagesSection() {
  const dealStages = useDealStages();
  const crmPermissions = useCrmPermissions();
  const teamCrmConfig = useTeamCrmConfig();
  const closedStageIds = useClosedStageIds(dealStages.stages);
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
    busy,
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
    toggleClosedStage,
  } = createStageEditor({
    dealStages,
    crmPermissions,
    teamCrmConfig,
    closedStageIds,
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

  return (
    <SettingsSection
      title="Deal stages"
      description="The pipeline stages deals move through on the CRM board."
      actions={
        <Show when={dealStages.isCustomized() && canEdit()}>
          <Button
            variant="outline"
            size="sm"
            disabled={blocked()}
            onClick={() => setShowResetModal(true)}
          >
            Reset to defaults
          </Button>
        </Show>
      }
    >
      <Show
        when={!loading() && !failed()}
        fallback={
          <SettingsCard>
            <Show
              when={failed()}
              fallback={
                <div class="animate-pulse bg-skeleton rounded h-4 w-32 m-6" />
              }
            >
              <div class="px-6 py-4 text-sm text-ink-muted">
                Deal stages could not be loaded. Reload to try again.
              </div>
            </Show>
          </SettingsCard>
        }
      >
        <Show
          when={dealStages.isCustomized()}
          fallback={
            <SettingsCard>
              <div class="flex flex-col gap-1 px-6 py-4">
                <For each={dealStages.stages()}>
                  {(stage) => (
                    <div class="flex items-center gap-2 py-1">
                      <StageDot />
                      <span class="text-sm text-ink">{stage.label}</span>
                    </div>
                  )}
                </For>
              </div>
              <div class="flex items-center justify-between gap-4 px-6 py-3.5">
                <p class="text-xs text-ink-muted">
                  Stages are Macro's defaults. Customize them for your team.
                </p>
                <Show when={canEdit()}>
                  <Button
                    variant="outline"
                    size="sm"
                    class="shrink-0"
                    disabled={busy()}
                    onClick={handleCustomize}
                  >
                    <Show when={pending()} fallback="Customize stages">
                      <SpinnerIcon class="size-4 animate-spin" />
                    </Show>
                  </Button>
                </Show>
              </div>
            </SettingsCard>
          }
        >
          <SettingsCard>
            <StageList ids={stageIds()}>
              <For each={orderedStages()}>
                {(stage, index) => (
                  <StageEditorRow
                    id={stage.id}
                    label={stage.label}
                    draft={drafts[stage.id]}
                    index={index()}
                    count={orderedStages().length}
                    disabled={!canEdit()}
                    pending={busy()}
                    onDraft={(value) => setDrafts(stage.id, value)}
                    onRename={(label) => handleRename(index(), label)}
                    onMove={(direction) => handleMove(index(), direction)}
                    onDelete={() => setStageToDelete(stage)}
                  />
                )}
              </For>
            </StageList>
            <Show when={canEdit()}>
              <div class="flex items-center gap-2 px-6 py-2.5">
                <PlusIcon class="size-4 shrink-0 text-ink-muted" />
                <input
                  type="text"
                  value={newStageName()}
                  onInput={(e) => setNewStageName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddStage();
                  }}
                  placeholder="Add stage"
                  class="settings-input flex-1 min-w-0"
                />
                <Button
                  variant="outline"
                  size="sm"
                  class="shrink-0"
                  disabled={newStageName().trim() === '' || busy()}
                  onClick={handleAddStage}
                >
                  Add
                </Button>
              </div>
            </Show>
          </SettingsCard>
        </Show>
        <div aria-live="polite" class="sr-only">
          {announcement()}
        </div>

        <SettingsCard>
          <SettingsRow
            align="start"
            label="Closed stages"
            description="Stages that count as closed deals. Moving deals out of a closed stage can be restricted under Permissions."
          >
            <div class="flex flex-col items-start gap-1.5">
              <For each={orderedStages()}>
                {(stage) => (
                  <Checkbox
                    checked={closedStageIds().has(stage.id)}
                    onChange={() => toggleClosedStage(stage.id)}
                    disabled={!canEdit() || blocked()}
                    class="cursor-default"
                  >
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <Checkbox.Label class="text-sm text-ink">
                      {stage.label}
                    </Checkbox.Label>
                  </Checkbox>
                )}
              </For>
            </div>
          </SettingsRow>
        </SettingsCard>
      </Show>

      <ConfirmDialog
        open={!!stageToDelete()}
        title="Delete Stage"
        confirmLabel="Delete Stage"
        pending={replaceMutation.isPending}
        onConfirm={handleDeleteStage}
        onClose={() => setStageToDelete(null)}
      >
        <p>
          Are you sure you want to delete{' '}
          <span class="font-medium">{stageToDelete()?.label ?? ''}</span>?
          Companies currently in this stage lose it and show under No stage on
          the board.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={showResetModal()}
        title="Reset Stages"
        confirmLabel="Reset to Defaults"
        pending={resetMutation.isPending}
        onConfirm={handleReset}
        onClose={() => setShowResetModal(false)}
      >
        <p>
          This removes your team's custom stage set and returns everyone to
          Macro's default stages.
        </p>
        <p class="text-sm text-ink-muted">
          Companies keep their stored stage values, and stages whose names match
          a default continue to display as before.
        </p>
      </ConfirmDialog>
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
        description="Enable your team's CRM and shape its deal pipeline."
      >
        <CrmEnablementSection />
        <Show when={teamQuery.data?.team.crm_enabled}>
          <DealStagesSection />
        </Show>
      </SettingsPage>
    </Show>
  );
}

export function Crm() {
  return (
    <Suspense
      fallback={<div class="animate-pulse bg-skeleton rounded h-4 w-32 m-6" />}
    >
      <CrmContent />
    </Suspense>
  );
}
