import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import PlugsIcon from '@phosphor/plugs.svg';
import XIcon from '@phosphor/x.svg';
import {
  useApproveHarnessPairingMutation,
  useHarnessPairingQuery,
} from '@queries/harnesses/harnesses';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { createSignal, Show } from 'solid-js';
import { ArtifactDialog } from '../components/ArtifactDialog';
import { Segmented } from '../components/Segmented';

const PAIRING_ERROR =
  'This pairing code is invalid, expired, or already claimed.';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

/** `kx7m4qhd` → `KX7M-4QHD`, at most eight characters. */
function formatCode(raw: string): string {
  const chars = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars;
}

function expiresIn(expiresAt: string): string {
  const minutes = Math.max(
    0,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000)
  );
  return minutes === 1 ? 'in 1 minute' : `in ${minutes} minutes`;
}

/**
 * Approves a macrod pairing request: the code the daemon printed, a name for
 * the runtime, and who may run agents on it.
 */
export function PairRuntimeDialog(props: { onClose: () => void }) {
  const [code, setCode] = createSignal('');
  const [name, setName] = createSignal('');
  const [nameEdited, setNameEdited] = createSignal(false);
  const [share, setShare] = createSignal<'private' | 'team'>('private');
  const [error, setError] = createSignal<string>();
  const complete = () => code().length === 9;
  const pairingQuery = useHarnessPairingQuery(() =>
    complete() ? code() : undefined
  );
  const approve = useApproveHarnessPairingMutation();
  const currentTeamQuery = useCurrentTeamQuery();
  const teamId = () =>
    currentTeamQuery.isSuccess ? currentTeamQuery.data?.team.id : undefined;
  const pairing = () =>
    pairingQuery.isSuccess ? pairingQuery.data : undefined;
  const lookupError = () =>
    complete() && pairingQuery.isError
      ? failureMessage(pairingQuery.error, PAIRING_ERROR)
      : undefined;
  const requestedName = () => {
    const details = pairing();
    return details && !nameEdited() ? details.requested_name : name();
  };
  const canApprove = () =>
    !!pairing() &&
    requestedName().trim().length > 0 &&
    !approve.isPending &&
    (share() === 'private' || teamId() !== undefined);

  const submit = async () => {
    const details = pairing();
    if (!details || !canApprove()) return;
    setError(undefined);
    try {
      await approve.mutateAsync({
        code: details.code,
        name: requestedName().trim(),
        teamId: share() === 'team' ? teamId() : undefined,
      });
      toast.success('Runtime paired');
      props.onClose();
    } catch (cause) {
      setError(failureMessage(cause, PAIRING_ERROR));
    }
  };

  return (
    <ArtifactDialog
      class="narrow"
      label="Pair a runtime"
      onClose={props.onClose}
    >
      <div class="dh">
        <span class="t">
          <PlugsIcon class="ph" />
          Pair a runtime
        </span>
        <button type="button" class="icon-btn" aria-label="Close" data-close>
          <XIcon class="ph" />
        </button>
      </div>
      <div class="db" style={{ gap: '16px' }}>
        <p
          style={{
            margin: 0,
            'font-size': '13.5px',
            color: 'var(--ink-muted)',
            'line-height': 1.5,
          }}
        >
          On the machine running your agent, start{' '}
          <code
            class="mono"
            style={{
              background: 'var(--surface-3)',
              padding: '1px 5px',
              'border-radius': '4px',
              color: 'var(--ink)',
            }}
          >
            macrod
          </code>{' '}
          and press <code class="mono">p</code> to pair. It prints an
          8-character code that is valid for 15 minutes. Enter it here to
          approve the pairing.
        </p>
        <div class="paircode">
          <input
            placeholder="XXXX-XXXX"
            maxlength={9}
            autocomplete="off"
            spellcheck={false}
            aria-label="Pairing code"
            value={code()}
            onInput={(event) => {
              setError(undefined);
              setCode(formatCode(event.currentTarget.value));
            }}
          />
        </div>
        <div class="grid2">
          <label class="field">
            <span>Name</span>
            <input
              class="sinput"
              placeholder="e.g. wolf-laptop"
              value={requestedName()}
              onInput={(event) => {
                setNameEdited(true);
                setName(event.currentTarget.value);
              }}
            />
          </label>
          <div class="field">
            <span>Share</span>
            <Segmented
              name="scope"
              value={share()}
              options={[
                { value: 'private', label: 'Private', icon: 'lock' },
                {
                  value: 'team',
                  label: 'Team',
                  icon: 'team',
                  disabled: teamId() === undefined,
                },
              ]}
              onChange={setShare}
            />
          </div>
        </div>
        <div class="kv" style={{ 'grid-template-columns': 'auto 1fr' }}>
          <span class="k">host</span>
          <span class="mono">
            {pairing()?.host ??
              (complete()
                ? pairingQuery.isPending
                  ? 'looking up code…'
                  : '—'
                : 'waiting for code…')}
          </span>
          <span class="k">expires</span>
          <span class="mono">
            {pairing() ? expiresIn(pairing()!.expires_at) : '—'}
          </span>
        </div>
        <Show when={error() ?? lookupError()}>
          {(message) => (
            <p style={{ margin: 0, 'font-size': '12px', color: 'var(--red)' }}>
              {message()}
            </p>
          )}
        </Show>
      </div>
      <div class="df">
        <span />
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" class="btn quiet" data-close>
            Cancel
          </button>
          <button
            type="button"
            class="btn"
            disabled={!canApprove()}
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-contrast)',
            }}
            onClick={() => void submit()}
          >
            {approve.isPending ? 'Approving…' : 'Approve pairing'}
          </button>
        </div>
      </div>
    </ArtifactDialog>
  );
}
