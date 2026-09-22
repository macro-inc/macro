import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import {
  useApproveHarnessPairingMutation,
  useHarnessPairingQuery,
} from '@queries/harnesses/harnesses';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button, Checkbox } from '@ui';
import { createEffect, createSignal, Match, Show, Switch } from 'solid-js';
import { RuntimeSetupSteps } from './components/runtime-setup-steps';
import { ChoiceRow, SettingsPage } from './primitives';

const PAIRING_ERROR_FALLBACK =
  'This pairing code is invalid, expired, or already claimed.';

type HarnessShare = 'Private' | 'Team';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

function expiresInMinutes(expiresAt: string): number {
  return Math.max(
    0,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000)
  );
}

/**
 * Page that walks the user through approving a macrod pairing request:
 * enter the printed code, review the request, and approve it as a private or
 * team runtime.
 */
export function RuntimePairingPage(props: {
  initialCode?: string;
  onClose: () => void;
}) {
  const [codeInput, setCodeInput] = createSignal(props.initialCode ?? '');
  const [committedCode, setCommittedCode] = createSignal<string | undefined>(
    props.initialCode || undefined
  );
  const [allowPermissionBypass, setAllowPermissionBypass] = createSignal(false);
  const [permissionBypassEdited, setPermissionBypassEdited] =
    createSignal(false);
  const [approved, setApproved] = createSignal(false);
  const [approveError, setApproveError] = createSignal<string>();
  const [name, setName] = createSignal('');
  const [nameEdited, setNameEdited] = createSignal(false);
  const [share, setShare] = createSignal<HarnessShare>('Private');
  const [shareEdited, setShareEdited] = createSignal(false);

  const pairingQuery = useHarnessPairingQuery(committedCode);
  const approveMutation = useApproveHarnessPairingMutation();
  const currentTeamQuery = useCurrentTeamQuery();
  const currentTeamId = () =>
    currentTeamQuery.isSuccess ? currentTeamQuery.data?.team.id : undefined;
  const canShareWithTeam = () => currentTeamId() !== undefined;
  const pairingData = () =>
    pairingQuery.isSuccess ? pairingQuery.data : undefined;

  createEffect(() => {
    const pairing = pairingData();
    if (!pairing) return;
    if (!nameEdited()) setName(pairing.requested_name);
    if (!permissionBypassEdited()) {
      setAllowPermissionBypass(
        pairing.requested_allow_permission_bypass === true
      );
    }
    // The daemon's config may ask for a scope; preselect it, but the person
    // approving keeps the final say.
    if (
      !shareEdited() &&
      pairing.requested_scope === 'team' &&
      canShareWithTeam()
    ) {
      setShare('Team');
    }
  });

  const lookupError = () =>
    committedCode() !== undefined && pairingQuery.isError
      ? failureMessage(pairingQuery.error, PAIRING_ERROR_FALLBACK)
      : undefined;
  const errorMessage = () => approveError() ?? lookupError();

  const lookUp = () => {
    const code = codeInput().trim().toUpperCase();
    if (code.length === 0) return;
    setCodeInput(code);
    setCommittedCode(code);
  };

  const tryAnotherCode = () => {
    setCommittedCode(undefined);
    setApproveError(undefined);
    setNameEdited(false);
    setName('');
    setShare('Private');
    setShareEdited(false);
    setAllowPermissionBypass(false);
    setPermissionBypassEdited(false);
  };

  const canApprove = () =>
    !approveMutation.isPending &&
    name().trim().length > 0 &&
    (share() === 'Private' || canShareWithTeam());

  const approve = async () => {
    const pairing = pairingData();
    if (!pairing || !canApprove()) return;

    setApproveError(undefined);
    try {
      await approveMutation.mutateAsync({
        code: pairing.code,
        allowPermissionBypass:
          pairing.requested_allow_permission_bypass !== false &&
          allowPermissionBypass(),
        name: name().trim(),
        teamId: share() === 'Team' ? currentTeamId() : undefined,
      });
      setApproved(true);
      toast.success('Runtime connected');
    } catch (error) {
      setApproveError(failureMessage(error, PAIRING_ERROR_FALLBACK));
    }
  };

  return (
    <SettingsPage
      title={approved() ? 'Runtime connected' : 'New runtime'}
      showTitleInSheet
      description="Connect an agent running on your own machine."
      actions={
        <Button
          variant="ghost"
          size="sm"
          disabled={approveMutation.isPending}
          onClick={props.onClose}
        >
          <ArrowLeftIcon />
          Back
        </Button>
      }
    >
      <section
        aria-label="New runtime"
        class="@container rounded-xl border border-edge-muted bg-surface-2 p-6"
      >
        <Switch>
          <Match when={approved()}>
            <p class="text-sm leading-5 text-ink-muted">
              Runtime connected. macrod will finish pairing automatically.
            </p>
          </Match>

          <Match when={errorMessage()}>
            {(message) => (
              <div class="flex flex-col gap-3">
                <p class="text-sm leading-5 text-negative">{message()}</p>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={tryAnotherCode}
                  >
                    Try another code
                  </Button>
                </div>
              </div>
            )}
          </Match>

          <Match when={pairingData()}>
            {(pairing) => (
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-1.5">
                  <div class="rounded-lg border border-edge-muted bg-ink/[0.025] px-3 py-3 text-center font-mono text-2xl tracking-[0.2em] text-ink">
                    {pairing().code}
                  </div>
                  <p class="text-xs text-ink-muted">
                    Confirm this matches the code macrod printed.
                  </p>
                </div>

                <div class="flex flex-col gap-0.5 text-xs text-ink-muted">
                  <span>
                    Requested name:{' '}
                    <span class="text-ink">{pairing().requested_name}</span>
                  </span>
                  <Show when={pairing().host}>
                    {(host) => (
                      <span>
                        Host: <span class="text-ink">{host()}</span>
                      </span>
                    )}
                  </Show>
                  <span>
                    Expires in {expiresInMinutes(pairing().expires_at)} minutes
                  </span>
                </div>

                <label class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-ink">Name</span>
                  <input
                    class="settings-input w-full"
                    value={name()}
                    onInput={(event) => {
                      setNameEdited(true);
                      setName(event.currentTarget.value);
                    }}
                  />
                </label>

                <fieldset class="grid grid-cols-1 gap-2 @min-[440px]:grid-cols-2">
                  <legend class="sr-only">Share</legend>
                  <ChoiceRow
                    name="harness-share"
                    value="private"
                    checked={share() === 'Private'}
                    title="Private"
                    description="Only you can run agents on this runtime."
                    onChange={() => {
                      setShareEdited(true);
                      setShare('Private');
                    }}
                  />
                  <ChoiceRow
                    name="harness-share"
                    value="team"
                    checked={share() === 'Team'}
                    title="Team"
                    description={
                      canShareWithTeam()
                        ? 'Your team can run agents on this runtime.'
                        : 'Create or join a team before sharing runtimes.'
                    }
                    disabled={!canShareWithTeam()}
                    onChange={() => {
                      setShareEdited(true);
                      setShare('Team');
                    }}
                  />
                </fieldset>
                <div class="flex flex-col gap-2">
                  <Checkbox
                    class="flex items-center gap-3 text-sm"
                    checked={allowPermissionBypass()}
                    disabled={
                      pairing().requested_allow_permission_bypass === false
                    }
                    onChange={(allowed) => {
                      setPermissionBypassEdited(true);
                      setAllowPermissionBypass(allowed);
                    }}
                  >
                    <Checkbox.Control />
                    <Checkbox.Label>
                      Allow bypassing permission requests
                    </Checkbox.Label>
                  </Checkbox>
                  <p class="text-xs text-ink-muted">
                    {pairing().requested_allow_permission_bypass === false
                      ? 'This daemon requires permission prompts. Change its setting and pair again to allow bypass.'
                      : 'When off, every agent on this runtime must ask for permission.'}
                  </p>
                  <Show when={allowPermissionBypass()}>
                    <p class="text-xs text-negative" role="alert">
                      Agents can run commands and edit files on this machine
                      without approval. Only enable this if you trust everyone
                      who can create agents on this runtime.
                    </p>
                  </Show>
                </div>
              </div>
            )}
          </Match>

          <Match when={committedCode()}>
            <p class="text-sm text-ink-muted">Looking up pairing code…</p>
          </Match>

          <Match when>
            <RuntimeSetupSteps>
              <div class="flex flex-col gap-1.5">
                <label
                  for="harness-pairing-code"
                  class="text-xs font-medium text-ink"
                >
                  Pairing code
                </label>
                <div class="flex min-w-0 items-center gap-2 rounded-lg border border-edge-muted bg-ink/[0.025] px-3 py-2">
                  <input
                    id="harness-pairing-code"
                    autocomplete="off"
                    aria-describedby="harness-pairing-code-help"
                    spellcheck={false}
                    class="min-w-0 flex-1 bg-transparent font-mono text-sm uppercase tracking-widest text-ink outline-none"
                    placeholder="KX7M-4QHD"
                    value={codeInput()}
                    onInput={(event) =>
                      setCodeInput(event.currentTarget.value.toUpperCase())
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') lookUp();
                    }}
                  />
                </div>
                <p
                  id="harness-pairing-code-help"
                  class="text-xs text-ink-extra-muted"
                >
                  Already configured? Press <kbd>p</kbd> in macrod to get a new
                  code.
                </p>
              </div>
            </RuntimeSetupSteps>
          </Match>
        </Switch>
        <div class="mt-6 flex justify-end gap-2 border-t border-edge-muted pt-4">
          <Switch>
            <Match when={approved()}>
              <Button
                type="button"
                variant="cta"
                size="sm"
                onClick={props.onClose}
              >
                Done
              </Button>
            </Match>
            <Match when={errorMessage()}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={props.onClose}
              >
                Close
              </Button>
            </Match>
            <Match when={pairingData()}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={approveMutation.isPending}
                onClick={props.onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="cta"
                size="sm"
                disabled={!canApprove()}
                onClick={() => void approve()}
              >
                {approveMutation.isPending ? 'Approving…' : 'Approve'}
              </Button>
            </Match>
            <Match when={committedCode()}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={props.onClose}
              >
                Cancel
              </Button>
            </Match>
            <Match when>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={props.onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="cta"
                size="sm"
                disabled={codeInput().trim().length === 0}
                onClick={lookUp}
              >
                Look up
              </Button>
            </Match>
          </Switch>
        </div>
      </section>
    </SettingsPage>
  );
}
