import { isTouchDevice } from '@core/mobile/isTouchDevice';
import EyeIcon from '@icon/system/regular/eye.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import { Button, ButtonGroup, ConfirmDialog } from '@ui';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

type RecordVisibilityActionProps = {
  recordId: string;
  kind: 'company' | 'contact';
  name: string;
  hidden: boolean;
  canManage: boolean;
  pending: boolean;
  iconOnly?: boolean;
  grouped?: boolean;
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
  const permissionHintId = createUniqueId();
  const permissionHint =
    'Ask a team admin or owner to remove or restore this record.';
  let button: HTMLButtonElement | undefined;
  const label = () => (props.hidden ? 'Restore to CRM' : 'Remove from CRM');
  const tooltip = () => {
    if (!props.iconOnly) return;
    return props.canManage ? label() : permissionHint;
  };
  const size = () => {
    if (!props.iconOnly) return;
    if (isTouchDevice()) return 'icon-lg';
    return props.grouped ? 'icon-sm' : 'icon-md';
  };

  return (
    <div
      class={props.iconOnly ? 'contents' : 'flex flex-col items-start gap-2'}
    >
      <Dynamic
        component={props.grouped ? ButtonGroup.Button : Button}
        ref={button}
        variant={props.iconOnly ? 'ghost' : 'secondary'}
        size={size()}
        aria-label={label()}
        aria-describedby={!props.canManage ? permissionHintId : undefined}
        tooltip={tooltip()}
        disabled={!props.canManage || props.pending}
        onClick={() => setConfirming(true)}
      >
        <Show
          when={props.hidden}
          fallback={
            <EyeSlashIcon
              class={props.iconOnly ? 'size-4 touch:size-6' : 'size-4'}
            />
          }
        >
          <EyeIcon class={props.iconOnly ? 'size-4 touch:size-6' : 'size-4'} />
        </Show>
        <Show when={!props.iconOnly}>{label()}</Show>
      </Dynamic>
      <Show when={props.hidden && !props.iconOnly}>
        <p class="text-xs text-ink-muted">
          This {props.kind === 'company' ? 'company' : 'person'} is hidden from
          your team's CRM lists.
        </p>
      </Show>
      <Show when={!props.canManage}>
        <p
          id={permissionHintId}
          class={props.iconOnly ? 'sr-only' : 'text-xs text-ink-muted'}
        >
          {permissionHint}
        </p>
      </Show>
      <ConfirmDialog
        open={confirming()}
        onOpenChange={setConfirming}
        onCloseAutoFocus={
          props.iconOnly
            ? (event) => {
                event.preventDefault();
                button?.focus();
              }
            : undefined
        }
        title={`${label()}?`}
        confirmLabel={
          props.iconOnly ? (
            <span class="whitespace-normal">{label()}</span>
          ) : (
            label()
          )
        }
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
