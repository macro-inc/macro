import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import {
  useApproveHarnessPairingMutation,
  useHarnessPairingQuery,
} from '@queries/harnesses/harnesses';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button, Dialog, Panel } from '@ui';
import { createEffect, createSignal, Match, Show, Switch } from 'solid-js';
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
  const [name, setName] = createSignal('');
  const [nameEdited, setNameEdited] = createSignal(false);
  const [share, setShare] = createSignal<HarnessShare>('Private');
  const [shareEdited, setShareEdited] = createSignal(false);

  const pairingQuery = useHarnessPairingQuery(committedCode);
  const approveMutation = useApproveHarnessPairingMutation();
  const currentTeamQuery = useCurrentTeamQuery();
  const currentTeamId = () => currentTeamQuery.data?.team.id;
  const canShareWithTeam = () => currentTeamId() !== undefined;

  createEffect(() => {
    const pairing = pairingQuery.data;
    if (!pairing) return;
    if (!nameEdited()) setName(pairing.requested_name);
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
  };

  const canApprove = () =>
    !approveMutation.isPending &&
    name().trim().length > 0 &&
    (share() === 'Private' || canShareWithTeam());

  const approve = async () => {
    const pairing = pairingQuery.data;
    if (!pairing || !canApprove()) return;

    setApproveError(undefined);
    try {
      await approveMutation.mutateAsync({
        code: pairing.code,
        name: name().trim(),
        teamId: share() === 'Team' ? currentTeamId() : undefined,
      });
      setApproved(true);
      toast.success('Harness connected');
    } catch (error) {
      setApproveError(failureMessage(error, PAIRING_ERROR_FALLBACK));
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
      <Panel depth={2} class="rounded-xl text-ink">
        <Panel.Header class="px-5 py-3">
          <Dialog.Title class="text-sm font-semibold">
            {approved() ? 'Harness connected' : 'Connect a harness'}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-5">
          <Switch>
            <Match when={approved()}>
              <p class="text-sm leading-5 text-ink-muted">
                Harness connected. macrod will finish pairing automatically.
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

            <Match when={pairingQuery.data}>
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
                      Expires in {expiresInMinutes(pairing().expires_at)}{' '}
                      minutes
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

                  <fieldset class="grid grid-cols-2 gap-2 mobile:grid-cols-1">
                    <legend class="sr-only">Share</legend>
                    <ChoiceRow
                      name="harness-share"
                      value="private"
                      checked={share() === 'Private'}
                      title="Private"
                      description="Only you can run agents on this harness."
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
                          ? 'Your team can run agents on this harness.'
                          : 'Create or join a team before sharing harnesses.'
                      }
                      disabled={!canShareWithTeam()}
                      onChange={() => {
                        setShareEdited(true);
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
                    autofocus
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
                  Run macrod on your computer and enter the code it prints.
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
            <Match when={pairingQuery.data}>
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
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}
