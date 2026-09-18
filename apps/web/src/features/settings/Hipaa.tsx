import { useSettingsState } from '@core/constant/SettingsState';
import {
  useSetWorkspacePrivacyMutation,
  useWorkspacePrivacyQuery,
} from '@queries/team/privacy';
import { Button, ConfirmDialog, ToggleSwitch } from '@ui';
import { createSignal, Show } from 'solid-js';
import { SettingsRow } from './primitives';

/** Render inside the Team settings Suspense boundary. */
export function HipaaSettings() {
  const privacy = useWorkspacePrivacyQuery();
  const mutation = useSetWorkspacePrivacyMutation();
  const { openSettings } = useSettingsState();
  const [confirmDisable, setConfirmDisable] = createSignal(false);
  const status = () => (privacy.isSuccess ? privacy.data : undefined);
  const save = (enabled: boolean) => {
    const current = status();
    if (!current) return;
    mutation.mutate({ enabled, expected_revision: current.revision });
  };

  return (
    <>
      <SettingsRow
        label="HIPAA safeguards"
        description={
          <div class="space-y-1">
            <p>
              Hide notification content and disable optional analytics for this
              workspace.
            </p>
            <p>
              A paid workspace, signed BAA, and Macro readiness review are
              required before handling protected health information.
            </p>
            <Show
              when={
                status()?.paid &&
                !status()?.hipaa_ready &&
                !status()?.hipaa_enabled
              }
            >
              <p>
                Contact Macro to complete your BAA and activate eligibility.
              </p>
            </Show>
            <Show when={privacy.isError}>
              <p role="alert">Unable to load privacy settings. Try again.</p>
            </Show>
            <Show when={mutation.isError}>
              <p role="alert">
                Could not update safeguards. Refresh and check your workspace's
                eligibility.
              </p>
            </Show>
          </div>
        }
      >
        <Show
          when={status()?.is_admin}
          fallback={
            <span class="text-xs text-ink-muted">
              {status()
                ? `${status()?.hipaa_enabled ? 'On' : 'Off'} · Admin managed`
                : 'Loading'}
            </span>
          }
        >
          <Show
            when={status()?.paid || status()?.hipaa_enabled}
            fallback={
              <Button
                size="sm"
                variant="outline"
                onClick={() => openSettings('Billing')}
              >
                Upgrade for HIPAA
              </Button>
            }
          >
            <ToggleSwitch
              label="HIPAA safeguards"
              labelClass="sr-only"
              size="md"
              checked={status()?.hipaa_enabled ?? false}
              disabled={
                mutation.isPending ||
                (!status()?.hipaa_enabled && !status()?.hipaa_ready)
              }
              onChange={(enabled) =>
                enabled ? save(true) : setConfirmDisable(true)
              }
            />
          </Show>
        </Show>
      </SettingsRow>
      <ConfirmDialog
        open={confirmDisable()}
        onOpenChange={setConfirmDisable}
        title="Turn off HIPAA safeguards?"
        body="Notifications may show content and optional analytics may resume. Only continue if your workspace no longer requires these protections."
        confirmLabel="Turn off safeguards"
        onConfirm={() => {
          setConfirmDisable(false);
          save(false);
        }}
      />
    </>
  );
}
