/**
 * CRM settings tab: team admins manage the CRM here — enablement, deal
 * stages (with the closed-stage set), custom company properties, and the
 * team's CRM permission thresholds.
 *
 * Deal stages are Macro's system defaults until the team customizes them,
 * which materializes a team-scoped `Stage` select property whose options are
 * the stages (see `@companies/crm/deal-stages`). Permissions and the closed
 * stage set live in the shared team CRM config
 * (see `@companies/crm/team-crm-config`).
 */

import {
  CRM_TEAM_STAGE_DEFINITION_NAME,
  type DealStage,
  findTeamStageDefinition,
  useDealStages,
} from '@companies/crm/deal-stages';
import {
  type CrmPermissionRole,
  type CrmPermissions,
  isReservedPropertyDefinitionName,
  useClosedStageIds,
  useCrmPermissions,
  useTeamCrmConfig,
} from '@companies/crm/team-crm-config';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { throwOnErr } from '@core/util/result';
import type { CollectionNode } from '@kobalte/core';
import { Select } from '@kobalte/core/select';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import TrashIcon from '@phosphor/trash.svg';
import XIcon from '@phosphor/x.svg';
import {
  useCreatePropertyDefinitionMutation,
  useDeletePropertyDefinitionMutation,
  useListPropertiesQuery,
} from '@queries/properties/definitions';
import {
  useAddPropertyOptionMutation,
  useDeletePropertyOptionMutation,
  useUpdatePropertyOptionMutation,
} from '@queries/properties/options';
import {
  invalidateUserTeams,
  useCurrentTeamQuery,
  useIsTeamAdmin,
} from '@queries/team/teams';
import { fetchWithAuth } from '@service-auth/fetch';
import type { PatchTeamCrmSettingsRequest } from '@service-auth/generated/schemas/patchTeamCrmSettingsRequest';
import type { PatchTeamCrmSettingsResponse } from '@service-auth/generated/schemas/patchTeamCrmSettingsResponse';
import type { PropertyDataType } from '@service-properties/generated/schemas/propertyDataType';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import { useMutation, useQueryClient } from '@tanstack/solid-query';
import { Button, Checkbox, Dialog, Panel, Tooltip } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';

const authHost = SERVER_HOSTS['auth-service'];

/* ------------------------------------------------------------------ */
/* Shared bits                                                        */
/* ------------------------------------------------------------------ */

/** Read the label text out of a select-string property option. */
function optionLabel(option: PropertyOption): string {
  const value = option.value;
  if (
    value &&
    typeof value === 'object' &&
    'value' in value &&
    typeof value.value === 'string'
  ) {
    return value.value;
  }
  return '';
}

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
              class="rounded-xs"
              disabled={props.pending}
              onClick={props.onClose}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              class="rounded-xs"
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

/** Small single-select dropdown in the style of the Team tab's role select. */
function InlineSelect<T extends string>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  type Option = { value: T; label: string };
  const selectedOption = () =>
    props.options.find((o) => o.value === props.value) ?? props.options[0];

  return (
    <Select<Option>
      options={props.options}
      value={selectedOption()}
      onChange={(opt) => opt && props.onChange(opt.value)}
      optionValue="value"
      optionTextValue="label"
      gutter={4}
      placement="bottom-end"
      disabled={props.disabled}
      itemComponent={(itemProps: { item: CollectionNode<Option> }) => (
        <Select.Item
          item={itemProps.item}
          class="flex items-center justify-between gap-2 px-2 py-1.5 text-sm rounded-xs hover:bg-hover outline-none data-highlighted:bg-hover"
        >
          <Select.ItemLabel>{itemProps.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator>
            <CheckIcon class="size-3" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger
        as={Button}
        class="rounded-xs px-1.5 py-0.5 text-xs data-expanded:bg-ink/10"
        disabled={props.disabled}
      >
        <Select.Value<Option>>
          {(state) => state.selectedOption().label}
        </Select.Value>
        <CaretDownIcon class="size-3 text-ink-muted shrink-0" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content class="z-50 bg-surface ring-1 ring-edge rounded shadow-lg min-w-25 p-1">
          <Select.Listbox />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}

/* ------------------------------------------------------------------ */
/* CRM enablement                                                     */
/* ------------------------------------------------------------------ */

/**
 * PATCH /team/crm on the auth service. The generated orval client
 * (`patchTeamCrmSettings`) issues a bare relative `fetch` with no auth, so we
 * go through `fetchWithAuth` against the auth host like `authServiceClient`.
 */
function usePatchTeamCrmSettingsMutation() {
  return useMutation(() => ({
    mutationFn: async (enabled: boolean) =>
      await throwOnErr(() =>
        fetchWithAuth<PatchTeamCrmSettingsResponse>(`${authHost}/team/crm`, {
          method: 'PATCH',
          body: JSON.stringify({
            enabled,
          } satisfies PatchTeamCrmSettingsRequest),
        })
      ),
    onSuccess: (data: PatchTeamCrmSettingsResponse) => {
      invalidateUserTeams();
      toast.success(data.enabled ? 'CRM enabled' : 'CRM disabled');
    },
    onError: (error: Error) => {
      console.error('Failed to update CRM settings', error);
      toast.failure('Failed to update CRM settings');
    },
  }));
}

const DISABLE_CRM_PHRASE = 'Disable CRM';

function CrmEnablementSection() {
  const isTeamAdmin = useIsTeamAdmin();
  const patchCrmMutation = usePatchTeamCrmSettingsMutation();

  // The team API doesn't report `crm_enabled`, so the toggle is optimistic:
  // it starts from "enabled" and tracks the results of changes made here.
  const [crmEnabled, setCrmEnabled] = createSignal(true);
  const [showDisableModal, setShowDisableModal] = createSignal(false);
  const [disableConfirmation, setDisableConfirmation] = createSignal('');

  const handleToggle = (next: boolean) => {
    if (!isTeamAdmin() || patchCrmMutation.isPending) return;
    if (next) {
      patchCrmMutation.mutate(true, {
        onSuccess: (data) => setCrmEnabled(data.enabled),
      });
    } else {
      // Disabling purges the team's CRM data — force a typed confirmation.
      setDisableConfirmation('');
      setShowDisableModal(true);
    }
  };

  const handleDisable = () => {
    patchCrmMutation.mutate(false, {
      onSuccess: (data) => {
        setCrmEnabled(data.enabled);
        setShowDisableModal(false);
      },
    });
  };

  return (
    <SettingsSection title="General">
      <SettingsCard>
        <SettingsRow
          label="Enable CRM"
          description="Turns the CRM on for everyone on your team. This setting isn't reported by the server, so the toggle reflects your latest change here."
          hideDescriptionOnMobile
        >
          <Show
            when={isTeamAdmin()}
            fallback={
              <Tooltip label="Only team admins can change CRM settings.">
                <span>
                  <Button variant="base" size="sm" class="rounded-xs" disabled>
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
                variant={crmEnabled() ? 'danger' : 'active'}
                size="sm"
                class="rounded-xs"
                disabled={patchCrmMutation.isPending}
                onClick={() => handleToggle(!crmEnabled())}
              >
                {crmEnabled() ? 'Disable CRM' : 'Enable CRM'}
              </Button>
            </div>
          </Show>
        </SettingsRow>
      </SettingsCard>

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
          Re-enabling later starts from a fresh backfill.
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
          class="w-full px-3 py-2 text-sm border border-edge-muted rounded-lg bg-surface text-ink placeholder:text-ink/30 outline-none focus:border-accent"
        />
      </ConfirmDialog>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Deal stages                                                        */
/* ------------------------------------------------------------------ */

function StageDot() {
  return <span class="size-2 shrink-0 rounded-full bg-accent/70" />;
}

/** Editable row for a custom stage: inline rename, reorder, delete. */
function StageEditorRow(props: {
  label: string;
  index: number;
  count: number;
  disabled: boolean;
  pending: boolean;
  onRename: (value: string) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = createSignal<string>();
  const value = () => editing() ?? props.label;
  const hasChanged = () => {
    const edited = editing();
    return (
      edited !== undefined &&
      edited.trim() !== '' &&
      edited.trim() !== props.label
    );
  };
  const commit = () => {
    if (!hasChanged()) return;
    props.onRename(value().trim());
    setEditing(undefined);
  };
  const cancel = () => setEditing(undefined);
  const isLastStage = () => props.count <= 1;

  return (
    <div class="flex items-center gap-2 px-6 py-2.5">
      <StageDot />
      <input
        type="text"
        value={value()}
        disabled={props.disabled}
        onInput={(e) => setEditing(e.currentTarget.value)}
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
      <Show when={hasChanged()}>
        <Tooltip label="Save">
          <Button
            variant="active"
            size="icon-sm"
            class="rounded-xs shrink-0"
            disabled={props.pending}
            onClick={commit}
          >
            <Show when={props.pending} fallback={<CheckIcon class="size-4" />}>
              <SpinnerIcon class="size-4 animate-spin" />
            </Show>
          </Button>
        </Tooltip>
        <Tooltip label="Cancel">
          <Button
            variant="ghost"
            size="icon-sm"
            class="rounded-xs shrink-0"
            disabled={props.pending}
            onClick={cancel}
          >
            <XIcon class="size-4" />
          </Button>
        </Tooltip>
      </Show>
      <div class="flex items-center gap-0.5 shrink-0">
        <Tooltip label="Move up">
          <Button
            variant="ghost"
            size="icon-sm"
            class="rounded-xs"
            disabled={props.disabled || props.pending || props.index === 0}
            onClick={() => props.onMove(-1)}
          >
            <CaretUpIcon class="size-4" />
          </Button>
        </Tooltip>
        <Tooltip label="Move down">
          <Button
            variant="ghost"
            size="icon-sm"
            class="rounded-xs"
            disabled={
              props.disabled || props.pending || props.index === props.count - 1
            }
            onClick={() => props.onMove(1)}
          >
            <CaretDownIcon class="size-4" />
          </Button>
        </Tooltip>
        <Tooltip
          label={
            isLastStage() ? 'At least one stage is required' : 'Delete stage'
          }
        >
          <Button
            variant="ghost"
            size="icon-sm"
            class="rounded-xs"
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
  const queryClient = useQueryClient();
  const dealStages = useDealStages();
  const crmPermissions = useCrmPermissions();
  const isTeamAdmin = useIsTeamAdmin();
  const teamCrmConfig = useTeamCrmConfig();
  const closedStageIds = useClosedStageIds(dealStages.stages);

  const teamDefinitionsQuery = useListPropertiesQuery(() => ({
    scope: 'team',
    includeOptions: true,
  }));
  const stageDefinition = createMemo(() =>
    findTeamStageDefinition(teamDefinitionsQuery.data)
  );

  const canEdit = createMemo(
    () => isTeamAdmin() && crmPermissions.canEditStages()
  );

  // The option mutations only invalidate the per-definition options query;
  // the stage list here is derived from the team definitions listing, so
  // refresh that too after every option change.
  const invalidateDefinitions = () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey.includes('properties') && queryKey.includes('definitions'),
    });
  const optionCallbacks = { onSuccess: () => invalidateDefinitions() };

  const createDefinitionMutation = useCreatePropertyDefinitionMutation();
  const deleteDefinitionMutation = useDeletePropertyDefinitionMutation();
  const addOptionMutation = useAddPropertyOptionMutation(optionCallbacks);
  const updateOptionMutation = useUpdatePropertyOptionMutation(optionCallbacks);
  const deleteOptionMutation = useDeletePropertyOptionMutation(optionCallbacks);

  const [isCustomizing, setIsCustomizing] = createSignal(false);
  const [newStageName, setNewStageName] = createSignal('');
  const [stageToDelete, setStageToDelete] = createSignal<PropertyOption | null>(
    null
  );
  const [showResetModal, setShowResetModal] = createSignal(false);

  /** Team stage options in display order (empty when not customized). */
  const stageOptions = createMemo((): PropertyOption[] => {
    const definition = stageDefinition();
    if (!definition) return [];
    return [...definition.property_options].sort(
      (a, b) => a.display_order - b.display_order
    );
  });

  const mutationPending = () =>
    addOptionMutation.isPending ||
    updateOptionMutation.isPending ||
    deleteOptionMutation.isPending;

  /** Seed the team stage set from the currently active (default) stages. */
  const handleCustomize = async () => {
    if (isCustomizing()) return;
    setIsCustomizing(true);
    try {
      const seedStages: DealStage[] = dealStages.stages();
      const definition = await createDefinitionMutation.mutateAsync({
        body: {
          display_name: CRM_TEAM_STAGE_DEFINITION_NAME,
          data_type: { type: 'select_string', multi: false, options: [] },
          scope: 'team',
        },
      });
      for (const [index, stage] of seedStages.entries()) {
        await addOptionMutation.mutateAsync({
          propertyDefinitionId: definition.id,
          body: {
            type: 'select_string',
            option: { value: stage.label, display_order: index },
          },
        });
      }
      toast.success('Stages are now customizable');
    } catch (error) {
      console.error('Failed to customize stages', error);
      // The mutations already toast their own failures.
    } finally {
      setIsCustomizing(false);
    }
  };

  const handleRename = (option: PropertyOption, value: string) => {
    const definition = stageDefinition();
    if (!definition) return;
    updateOptionMutation.mutate({
      propertyDefinitionId: definition.definition.id,
      optionId: option.id,
      body: { value },
    });
  };

  /** Swap display orders with the neighbor in the given direction. */
  const handleMove = async (index: number, direction: -1 | 1) => {
    const definition = stageDefinition();
    const options = stageOptions();
    const current = options[index];
    const neighbor = options[index + direction];
    if (!definition || !current || !neighbor) return;
    // Swap the stored orders; fall back to list indices if they collide.
    let currentOrder = neighbor.display_order;
    let neighborOrder = current.display_order;
    if (currentOrder === neighborOrder) {
      currentOrder = index + direction;
      neighborOrder = index;
    }
    await updateOptionMutation.mutateAsync({
      propertyDefinitionId: definition.definition.id,
      optionId: current.id,
      body: { display_order: currentOrder },
    });
    await updateOptionMutation.mutateAsync({
      propertyDefinitionId: definition.definition.id,
      optionId: neighbor.id,
      body: { display_order: neighborOrder },
    });
  };

  const handleAddStage = () => {
    const definition = stageDefinition();
    const value = newStageName().trim();
    if (!definition || value === '') return;
    addOptionMutation.mutate(
      {
        propertyDefinitionId: definition.definition.id,
        body: {
          type: 'select_string',
          option: { value, display_order: stageOptions().length },
        },
      },
      { onSuccess: () => setNewStageName('') }
    );
  };

  const handleDeleteStage = () => {
    const definition = stageDefinition();
    const option = stageToDelete();
    if (!definition || !option) return;
    deleteOptionMutation.mutate(
      {
        propertyDefinitionId: definition.definition.id,
        optionId: option.id,
      },
      { onSuccess: () => setStageToDelete(null) }
    );
  };

  const handleReset = () => {
    const definition = stageDefinition();
    if (!definition) return;
    deleteDefinitionMutation.mutate(
      { definitionId: definition.definition.id },
      {
        onSuccess: () => {
          setShowResetModal(false);
          toast.success('Stages reset to Macro defaults');
        },
      }
    );
  };

  const toggleClosedStage = (stageId: string) => {
    const next = new Set(closedStageIds());
    if (next.has(stageId)) {
      next.delete(stageId);
    } else {
      next.add(stageId);
    }
    teamCrmConfig.update.mutate((cfg) => ({
      ...cfg,
      closedStageIds: [...next],
    }));
  };

  return (
    <SettingsSection
      title="Deal stages"
      description="The pipeline stages deals move through on the CRM board."
      actions={
        <Show when={stageDefinition() && canEdit()}>
          <Button
            variant="base"
            size="sm"
            class="rounded-xs"
            disabled={deleteDefinitionMutation.isPending}
            onClick={() => setShowResetModal(true)}
          >
            Reset to defaults
          </Button>
        </Show>
      }
    >
      <Show
        when={stageDefinition()}
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
                  variant="base"
                  size="sm"
                  class="rounded-xs shrink-0"
                  disabled={isCustomizing()}
                  onClick={handleCustomize}
                >
                  <Show when={isCustomizing()} fallback="Customize stages">
                    <SpinnerIcon class="size-4 animate-spin" />
                  </Show>
                </Button>
              </Show>
            </div>
          </SettingsCard>
        }
      >
        <SettingsCard>
          <For each={stageOptions()}>
            {(option, index) => (
              <StageEditorRow
                label={optionLabel(option)}
                index={index()}
                count={stageOptions().length}
                disabled={!canEdit()}
                pending={mutationPending()}
                onRename={(value) => handleRename(option, value)}
                onMove={(direction) => handleMove(index(), direction)}
                onDelete={() => setStageToDelete(option)}
              />
            )}
          </For>
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
                variant="base"
                size="sm"
                class="rounded-xs shrink-0"
                disabled={newStageName().trim() === '' || mutationPending()}
                onClick={handleAddStage}
              >
                Add
              </Button>
            </div>
          </Show>
        </SettingsCard>
      </Show>

      <SettingsCard>
        <SettingsRow
          align="start"
          label="Closed stages"
          description="Stages that count as closed deals. Moving deals out of a closed stage can be restricted under Permissions."
        >
          <div class="flex flex-col items-start gap-1.5">
            <For each={dealStages.stages()}>
              {(stage) => (
                <Checkbox
                  checked={closedStageIds().has(stage.id)}
                  onChange={() => toggleClosedStage(stage.id)}
                  disabled={!canEdit() || teamCrmConfig.update.isPending}
                  class="cursor-default"
                >
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span class="text-sm text-ink">{stage.label}</span>
                </Checkbox>
              )}
            </For>
          </div>
        </SettingsRow>
      </SettingsCard>

      <ConfirmDialog
        open={!!stageToDelete()}
        title="Delete Stage"
        confirmLabel="Delete Stage"
        pending={deleteOptionMutation.isPending}
        onConfirm={handleDeleteStage}
        onClose={() => setStageToDelete(null)}
      >
        <p>
          Are you sure you want to delete{' '}
          <span class="font-medium">
            {stageToDelete()
              ? optionLabel(stageToDelete() as PropertyOption)
              : ''}
          </span>
          ? Companies currently in this stage keep their stored value but will
          no longer appear under it on the board.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={showResetModal()}
        title="Reset Stages"
        confirmLabel="Reset to Defaults"
        pending={deleteDefinitionMutation.isPending}
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
/* Company properties                                                 */
/* ------------------------------------------------------------------ */

const DATA_TYPE_LABELS: Record<string, string> = {
  STRING: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  BOOLEAN: 'Checkbox',
  SELECT_STRING: 'Select',
  SELECT_NUMBER: 'Number select',
  TAG: 'Tag',
  ENTITY: 'Relation',
  LINK: 'Link',
};

type NewPropertyType =
  | 'string'
  | 'number'
  | 'date'
  | 'boolean'
  | 'select_string'
  | 'link';

const NEW_PROPERTY_TYPE_OPTIONS: { value: NewPropertyType; label: string }[] = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Checkbox' },
  { value: 'select_string', label: 'Select' },
  { value: 'link', label: 'Link' },
];

/** Mirrors `buildDataType` in the property package's CreatePropertyModal. */
function buildDataType(type: NewPropertyType): PropertyDataType {
  return match<NewPropertyType, PropertyDataType>(type)
    .with('string', () => ({ type: 'string' }))
    .with('number', () => ({ type: 'number' }))
    .with('date', () => ({ type: 'date' }))
    .with('boolean', () => ({ type: 'boolean' }))
    .with('select_string', () => ({
      // Options are added later from the property's editors.
      type: 'select_string',
      multi: false,
      options: [],
    }))
    .with('link', () => ({ type: 'link', multi: false }))
    .exhaustive();
}

function CompanyPropertiesSection() {
  const isTeamAdmin = useIsTeamAdmin();
  const teamDefinitionsQuery = useListPropertiesQuery(() => ({
    scope: 'team',
    includeOptions: true,
  }));

  const createDefinitionMutation = useCreatePropertyDefinitionMutation();
  const deleteDefinitionMutation = useDeletePropertyDefinitionMutation();

  const [newName, setNewName] = createSignal('');
  const [newType, setNewType] = createSignal<NewPropertyType>('string');
  const [propertyToDelete, setPropertyToDelete] =
    createSignal<PropertyDefinition | null>(null);

  // Team-scoped custom properties, excluding internal reserved definitions
  // and the team Stage definition (managed in the section above).
  const customProperties = createMemo((): PropertyDefinition[] => {
    const entries = teamDefinitionsQuery.data ?? [];
    return entries
      .map((entry) => ('definition' in entry ? entry.definition : entry))
      .filter(
        (definition) =>
          definition.owner.scope === 'team' &&
          !definition.is_system &&
          !isReservedPropertyDefinitionName(definition.display_name) &&
          definition.display_name !== CRM_TEAM_STAGE_DEFINITION_NAME
      );
  });

  const canAdd = () =>
    newName().trim() !== '' && !createDefinitionMutation.isPending;

  const handleAdd = () => {
    if (!canAdd()) return;
    createDefinitionMutation.mutate(
      {
        body: {
          display_name: newName().trim(),
          data_type: buildDataType(newType()),
          scope: 'team',
        },
      },
      {
        onSuccess: () => {
          setNewName('');
          setNewType('string');
          toast.success('Property added');
        },
      }
    );
  };

  const handleDelete = () => {
    const property = propertyToDelete();
    if (!property) return;
    deleteDefinitionMutation.mutate(
      { definitionId: property.id },
      { onSuccess: () => setPropertyToDelete(null) }
    );
  };

  return (
    <SettingsSection
      title="Company properties"
      description="Custom fields that appear on every company in the CRM side panel."
    >
      <SettingsCard>
        <Show
          when={customProperties().length > 0}
          fallback={
            <div class="px-6 py-6 text-center text-sm text-ink-muted">
              No custom properties yet.
            </div>
          }
        >
          <For each={customProperties()}>
            {(definition) => (
              <div class="flex items-center justify-between gap-3 px-6 py-3">
                <div class="min-w-0 flex-1">
                  <div class="text-sm text-ink truncate">
                    {definition.display_name}
                  </div>
                  <div class="text-xs text-ink-muted">
                    {DATA_TYPE_LABELS[definition.data_type] ??
                      definition.data_type}
                  </div>
                </div>
                <Show when={isTeamAdmin()}>
                  <Tooltip label="Delete property">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="rounded-xs shrink-0"
                      disabled={deleteDefinitionMutation.isPending}
                      onClick={() => setPropertyToDelete(definition)}
                    >
                      <TrashIcon class="size-4" />
                    </Button>
                  </Tooltip>
                </Show>
              </div>
            )}
          </For>
        </Show>
        <Show when={isTeamAdmin()}>
          <div class="flex items-center gap-2 px-6 py-2.5">
            <PlusIcon class="size-4 shrink-0 text-ink-muted" />
            <input
              type="text"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
              placeholder="Add property"
              class="settings-input flex-1 min-w-0"
            />
            <InlineSelect
              options={NEW_PROPERTY_TYPE_OPTIONS}
              value={newType()}
              onChange={setNewType}
            />
            <Button
              variant="base"
              size="sm"
              class="rounded-xs shrink-0"
              disabled={!canAdd()}
              onClick={handleAdd}
            >
              <Show when={createDefinitionMutation.isPending} fallback="Add">
                <SpinnerIcon class="size-4 animate-spin" />
              </Show>
            </Button>
          </div>
        </Show>
      </SettingsCard>

      <ConfirmDialog
        open={!!propertyToDelete()}
        title="Delete Property"
        confirmLabel="Delete Property"
        pending={deleteDefinitionMutation.isPending}
        onConfirm={handleDelete}
        onClose={() => setPropertyToDelete(null)}
      >
        <p>
          Are you sure you want to delete{' '}
          <span class="font-medium">{propertyToDelete()?.display_name}</span>?
          Its values are removed from every company. This cannot be undone.
        </p>
      </ConfirmDialog>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Permissions                                                        */
/* ------------------------------------------------------------------ */

const PERMISSION_ROLE_OPTIONS: { value: CrmPermissionRole; label: string }[] = [
  { value: 'admin', label: 'Admins and owner' },
  { value: 'owner', label: 'Owner only' },
];

const PERMISSION_ROWS: {
  key: keyof CrmPermissions;
  label: string;
  description: string;
}[] = [
  {
    key: 'editStages',
    label: 'Edit deal stages',
    description: 'Who can change the deal stage set above.',
  },
  {
    key: 'moveClosedDeals',
    label: 'Move closed deals',
    description: 'Who can move deals out of a closed stage.',
  },
  {
    key: 'deleteRecords',
    label: 'Delete records',
    description: 'Who can delete companies and contacts from the CRM.',
  },
];

function PermissionsSection() {
  const isTeamAdmin = useIsTeamAdmin();
  const crmPermissions = useCrmPermissions();
  const teamCrmConfig = useTeamCrmConfig();

  const setPermission = (key: keyof CrmPermissions, value: CrmPermissionRole) =>
    teamCrmConfig.update.mutate((cfg) => ({
      ...cfg,
      permissions: { ...cfg.permissions, [key]: value },
    }));

  const roleLabel = (value: CrmPermissionRole) =>
    PERMISSION_ROLE_OPTIONS.find((o) => o.value === value)?.label ?? value;

  return (
    <SettingsSection
      title="Permissions"
      description="Team members are view-only in the CRM; these control what admins can change."
    >
      <SettingsCard>
        <For each={PERMISSION_ROWS}>
          {(row) => (
            <SettingsRow
              label={row.label}
              description={row.description}
              hideDescriptionOnMobile
            >
              <Show
                when={isTeamAdmin()}
                fallback={
                  <span class="text-xs text-ink-muted">
                    {roleLabel(crmPermissions.permissions()[row.key])}
                  </span>
                }
              >
                <InlineSelect
                  options={PERMISSION_ROLE_OPTIONS}
                  value={crmPermissions.permissions()[row.key]}
                  onChange={(value) => setPermission(row.key, value)}
                  disabled={teamCrmConfig.update.isPending}
                />
              </Show>
            </SettingsRow>
          )}
        </For>
      </SettingsCard>
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
        description="Manage deal stages, company properties, and permissions for your team's CRM."
      >
        <CrmEnablementSection />
        <DealStagesSection />
        <CompanyPropertiesSection />
        <PermissionsSection />
      </SettingsPage>
    </Show>
  );
}

export function Crm() {
  return (
    <Suspense
      fallback={
        <div class="animate-pulse bg-ink-extra-muted rounded h-4 w-32 m-6" />
      }
    >
      <CrmContent />
    </Suspense>
  );
}
