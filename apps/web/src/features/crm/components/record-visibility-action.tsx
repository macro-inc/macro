import EyeIcon from '@icon/system/regular/eye.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import { Button, ConfirmDialog } from '@ui';
import { createSignal, Show } from 'solid-js';

type RecordVisibilityActionProps = {
  recordId: string;
  kind: 'company' | 'contact';
  name: string;
  hidden: boolean;
  canManage: boolean;
  pending: boolean;
  onChange: (hidden: boolean, onSuccess: () => void) => void;
};

/** Removal uses the existing reversible, team-wide hidden state. */
export function RecordVisibilityAction(props: RecordVisibilityActionProps) {
  return (
    <Show when={props.recordId} keyed>
      {(recordId) => <VisibilityControl {...props} recordId={recordId} />}
    </Show>
  );
}

function VisibilityControl(props: RecordVisibilityActionProps) {
  const [confirming, setConfirming] = createSignal(false);
  const label = () => (props.hidden ? 'Restore to CRM' : 'Remove from CRM');

  return (
    <div class="flex flex-col items-start gap-2">
      <Button
        variant="secondary"
        disabled={!props.canManage || props.pending}
        onClick={() => setConfirming(true)}
      >
        <Show when={props.hidden} fallback={<EyeSlashIcon class="size-4" />}>
          <EyeIcon class="size-4" />
        </Show>
        {label()}
      </Button>
      <Show when={props.hidden}>
        <p class="text-xs text-ink-muted">
          This {props.kind === 'company' ? 'company' : 'person'} is hidden from
          your team's CRM lists.
        </p>
      </Show>
      <Show when={!props.canManage}>
        <p class="text-xs text-ink-muted">
          Ask a team admin or owner to remove or restore this record.
        </p>
      </Show>
      <ConfirmDialog
        open={confirming()}
        onOpenChange={setConfirming}
        title={`${label()}?`}
        confirmLabel={label()}
        pending={props.pending}
        onConfirm={() => {
          if (!props.canManage || props.pending) return;
          props.onChange(!props.hidden, () => setConfirming(false));
        }}
        body={
          <Show
            when={props.hidden}
            fallback={
              <>
                Hide <span class="font-medium text-ink">{props.name}</span> from
                your team's CRM lists. This does not permanently delete the
                record. You can restore it from this page.
                <Show when={props.kind === 'company'}>
                  {' '}
                  All of its contacts will also be hidden, and team email sync
                  will be turned off.
                </Show>
              </>
            }
          >
            Show <span class="font-medium text-ink">{props.name}</span> in your
            team's CRM lists again.
            <Show when={props.kind === 'company'}>
              {' '}
              All of its contacts will also be restored, including any hidden
              individually. Team email sync will stay off until you enable it
              separately.
            </Show>
            <Show when={props.kind === 'contact'}>
              {' '}
              If linked to a company, that company must also be visible for them
              to appear in People.
            </Show>
          </Show>
        }
      />
    </div>
  );
}
