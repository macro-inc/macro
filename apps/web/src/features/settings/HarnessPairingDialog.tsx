import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import {
  useApproveHarnessPairingMutation,
  useHarnessPairingQuery,
} from '@queries/harnesses/harnesses';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { ChoiceRow } from './primitives';

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
 * Dialog that walks the user through approving a macrod pairing request:
 * enter the printed code, review the request, and approve it as a private or
 * team harness.
 */
export function HarnessPairingDialog(props: {
  initialCode?: string;
  onClose: () => void;
}) {
  const [codeInput, setCodeInput] = createSignal(props.initialCode ?? '');
  const [committedCode, setCommittedCode] = createSignal<string | undefined>(
    props.initialCode || undefined
  );
  const [approved, setApproved] = createSignal(false);
  const [approveError, setApproveError] = createSignal<string>();
  const [nameOverride, setName] = createSignal<string>();
  const [shareOverride, setShare] = createSignal<HarnessShare>();

  const pairingQuery = useHarnessPairingQuery(committedCode);
  const approveMutation = useApproveHarnessPairingMutation();
  const currentTeamQuery = useCurrentTeamQuery();
  const currentTeamId = () =>
    currentTeamQuery.isSuccess ? currentTeamQuery.data?.team.id : undefined;
  const canShareWithTeam = () => currentTeamId() !== undefined;
  const pairingData = () =>
    pairingQuery.isSuccess ? pairingQuery.data : undefined;

  const name = () => nameOverride() ?? pairingData()?.requested_name ?? '';
  const share = () =>
    shareOverride() ??
    (pairingData()?.requested_scope === 'team' && canShareWithTeam()
      ? 'Team'
      : 'Private');

  const lookupError = () =>
    committedCode() !== undefined && pairingQuery.isError
      ? failureMessage(pairingQuery.error, PAIRING_ERROR_FALLBACK)
      : undefined;

  const lookUp = () => {
    const code = codeInput().trim().toUpperCase();
    if (code.length === 0) return;
    setCodeInput(code);
    setCommittedCode(code);
  };

  const tryAnotherCode = () => {
    setCommittedCode(undefined);
    setApproveError(undefined);
    setName(undefined);
    setShare(undefined);
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
        name: name().trim(),
        teamId: share() === 'Team' ? currentTeamId() : undefined,
      });
      setApproved(true);
      toast.success('Pairing approved');
    } catch (error) {
      setApproveError(
        failureMessage(error, 'Could not pair this runtime. Please try again.')
      );
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) =>
        !open && !approveMutation.isPending && props.onClose()
      }
      position="center"
      visibleScrim
      class="w-[min(480px,calc(100vw-16px))]"
    >
      <Panel depth={2} class="max-h-[88vh] rounded-xl text-ink">
        <Panel.Header class="px-5 py-3">
          <Dialog.Title class="text-sm font-semibold">
            {approved() ? 'Pairing approved' : 'Pair a runtime'}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="overflow-y-auto p-5">
          <Dialog.Description class="mb-5 text-sm leading-5 text-ink-muted">
            {approved()
              ? 'Your computer is approved to run agents in Macro.'
              : pairingData()
                ? 'Review this computer and choose who can use it.'
                : 'Connect a computer so your agents can work with its tools and projects.'}
          </Dialog.Description>
          <Switch>
            <Match when={approved()}>
              <p class="text-sm leading-5 text-ink-muted">
                Keep macrod running on your computer. Your runtime will show as
                connected once it checks in.
              </p>
            </Match>

            <Match when={lookupError()}>
              {(message) => (
                <div class="flex flex-col gap-3">
                  <p role="alert" class="text-sm leading-5 text-negative">
                    {message()}
                  </p>
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
                      Make sure this matches the code shown on your computer.
                    </p>
                  </div>

                  <div class="flex flex-col gap-0.5 text-xs text-ink-muted">
                    <span>
                      Computer:{' '}
                      <span class="text-ink">{pairing().requested_name}</span>
                    </span>
                    <Show when={pairing().host}>
                      {(host) => (
                        <span>
                          Address: <span class="text-ink">{host()}</span>
                        </span>
                      )}
                    </Show>
                    <span>
                      Expires in {expiresInMinutes(pairing().expires_at)}{' '}
                      minutes
                    </span>
                  </div>

                  <label class="flex flex-col gap-1.5">
                    <span class="text-xs font-medium text-ink">
                      Runtime name
                    </span>
                    <input
                      class="settings-input w-full"
                      value={name()}
                      onInput={(event) => {
                        setName(event.currentTarget.value);
                      }}
                    />
                  </label>

                  <Show when={approveError()}>
                    <p role="alert" class="text-sm text-negative">
                      {approveError()}
                    </p>
                  </Show>
                  <fieldset class="grid grid-cols-2 gap-2 mobile:grid-cols-1">
                    <legend class="mb-2 text-xs font-medium text-ink">
                      Who can use this runtime?
                    </legend>
                    <ChoiceRow
                      name="harness-share"
                      value="private"
                      checked={share() === 'Private'}
                      title="Private"
                      description="Only you can use this runtime."
                      onChange={() => {
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
                          ? 'Everyone on your team can use this runtime.'
                          : 'Create or join a team to share a runtime.'
                      }
                      disabled={!canShareWithTeam()}
                      onChange={() => {
                        setShare('Team');
                      }}
                    />
                  </fieldset>
                </div>
              )}
            </Match>

            <Match when={committedCode()}>
              <p class="text-sm text-ink-muted">Looking up pairing code…</p>
            </Match>

            <Match when>
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
                <p class="text-xs text-ink-extra-muted">
                  Enter the pairing code from macrod on the computer you want to
                  connect.
                </p>
              </div>
            </Match>
          </Switch>
        </Panel.Body>
        <Panel.Footer class="justify-end gap-2 px-5 py-3">
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
            <Match when={lookupError()}>
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
                {approveMutation.isPending ? 'Pairing…' : 'Pair runtime'}
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
                Continue
              </Button>
            </Match>
          </Switch>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}
