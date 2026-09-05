/** CRM settings tab: team admins enable or disable the CRM here. */

import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { throwOnErr } from '@core/util/result';
import SpinnerIcon from '@phosphor/spinner.svg';
import XIcon from '@phosphor/x.svg';
import {
  invalidateUserTeams,
  useCurrentTeamQuery,
  useIsTeamAdmin,
} from '@queries/team/teams';
import { fetchWithAuth } from '@service-auth/fetch';
import type { PatchTeamCrmSettingsRequest } from '@service-auth/generated/schemas/patchTeamCrmSettingsRequest';
import type { PatchTeamCrmSettingsResponse } from '@service-auth/generated/schemas/patchTeamCrmSettingsResponse';
import { useMutation } from '@tanstack/solid-query';
import { Button, Dialog, Panel, Tooltip } from '@ui';
import { createSignal, type JSX, Show, Suspense } from 'solid-js';
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
    mutationFn: async (req: PatchTeamCrmSettingsRequest) =>
      await throwOnErr(() =>
        fetchWithAuth<PatchTeamCrmSettingsResponse>(`${authHost}/team/crm`, {
          method: 'PATCH',
          body: JSON.stringify(req),
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
                  <Button
                    variant="outline"
                    size="sm"
                    class="rounded-xs"
                    disabled
                  >
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
                class="rounded-xs"
                disabled={patchCrmMutation.isPending}
                onClick={() => setShowEnableModal(false)}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                class="rounded-xs"
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
                variant="accent"
                class="rounded-xs"
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
        description="Enable or disable your team's CRM."
      >
        <CrmEnablementSection />
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
