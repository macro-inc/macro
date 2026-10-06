import { SendAsGroupToggle } from '@core/component/SendAsGroupToggle';
import { toast } from '@core/component/Toast/Toast';
import { ShareOptions } from '@core/component/TopBar/ShareButton';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { ActionDialogShell, Button, Hotkey } from '@ui';
import { createSignal, type JSX, onMount, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { ShareNotices, ShareReport } from '../components/share-status';
import type {
  PickedRecipient,
  ShareOutcome,
  ShareTarget,
} from '../core/delivery-plan';
import { parseChannelAccessLevel } from '../core/share-item';
import type { ShareForm } from '../primitives/create-share-form';

export function BulkShareView<Recipient extends PickedRecipient>(props: {
  form: ShareForm<Recipient>;
  /** Shareable rows, including any the share leaves out. */
  count: number;
  selection: JSX.Element;
  /** Must call `form.setRecipients`. */
  recipientField: JSX.Element;
  /** Must call `form.setText`. */
  messageField: JSX.Element;
  recipientName: (recipient: Recipient) => string;
  onFinish: () => void;
  onCancel: () => void;
  /** Fires when a share reached someone but did not complete, so the dialog stays open. */
  onDelivered: () => void;
}) {
  let root!: HTMLDivElement;
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('bulk-share', true);
  // The form drops the last outcome while a retry runs, so the report keeps
  // its own copy and stays on screen until the retry settles.
  const [report, setReport] = createSignal<ShareOutcome>();
  const sending = () => props.form.status().t === 'sending';
  const settled = () => report()?.retryable === false;
  // Once anyone has a message, a re-share from the kept selection would send
  // it again, so closing then clears the selection the way finishing does.
  const close = () =>
    report()?.delivered ? props.onFinish() : props.onCancel();

  const targetName = (target: ShareTarget) => {
    const name = (id: string) => {
      const recipient = props.form
        .recipients()
        .find((candidate) => candidate.id === id);
      return recipient ? props.recipientName(recipient) : id;
    };
    return match(target)
      .with({ t: 'channel' }, ({ channelId }) => name(channelId))
      .with({ t: 'people' }, ({ userIds }) => userIds.map(name).join(', '))
      .exhaustive();
  };

  async function share() {
    const result = await props.form.submit();
    if (!result) return;
    const { outcome, open } = result;
    if (!outcome.complete) {
      setReport(outcome);
      if (outcome.delivered) props.onDelivered();
      return;
    }
    const [only, ...others] = outcome.recipients;
    toast.success(
      only && others.length === 0
        ? `Shared with ${targetName(only.target)}`
        : `Shared with ${outcome.recipients.length} recipients`,
      open && { actions: [{ label: 'View in channel', onClick: open }] }
    );
    props.onFinish();
  }

  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId,
    description: 'Share',
    runWithInputFocused: true,
    keyDownHandler: (event) => {
      // Holding the shortcut repeats keydown. One press sends one share.
      if (event?.repeat) return true;
      if (settled()) props.onFinish();
      else void share();
      return true;
    },
  });

  onMount(() => attachHotkeys(root));

  return (
    <div ref={root} class="flex min-h-0 flex-col">
      <ActionDialogShell.Body>
        <ActionDialogShell.Header>
          <ActionDialogShell.Title>{`Share ${props.count} items`}</ActionDialogShell.Title>
          <ActionDialogShell.Description>
            Send these items to people or channels.
          </ActionDialogShell.Description>
        </ActionDialogShell.Header>
        {props.selection}
        <div class="space-y-3">
          {props.recipientField}
          <Show when={props.form.group()}>
            {(group) => (
              <SendAsGroupToggle
                on={group().on}
                locked={props.form.locked()}
                onChange={props.form.setGroup}
              />
            )}
          </Show>
          <Show when={props.form.level()}>
            {(level) => (
              <div class="flex items-center gap-2">
                <span class="text-sm text-ink-muted">Recipients can</span>
                <ShareOptions
                  allowedAccessLevels={level().options}
                  permissions={level().value}
                  setPermissions={(accessLevel) => {
                    const parsed =
                      accessLevel && parseChannelAccessLevel(accessLevel);
                    if (parsed) props.form.setLevel(parsed);
                  }}
                  label="Permission"
                  hideNoAccess
                  disabled={props.form.locked()}
                />
              </div>
            )}
          </Show>
        </div>
        {props.messageField}
        <Show
          when={report()}
          fallback={<ShareNotices notices={props.form.notices()} />}
        >
          {(outcome) => (
            <ShareReport outcome={outcome()} recipientName={targetName} />
          )}
        </Show>
      </ActionDialogShell.Body>
      <ActionDialogShell.Footer>
        <Show
          when={!settled()}
          fallback={
            <Button variant="strong" onClick={props.onFinish}>
              Done
              <Hotkey shortcut="cmd+enter" theme="current" />
            </Button>
          }
        >
          <Button variant="ghost" onClick={close}>
            {report() ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant="strong"
            disabled={
              props.form.recipients().length === 0 ||
              !props.form.sendable() ||
              sending()
            }
            onClick={() => void share()}
          >
            {report() ? 'Retry' : 'Share'}
            <Hotkey shortcut="cmd+enter" theme="current" />
          </Button>
        </Show>
      </ActionDialogShell.Footer>
    </div>
  );
}
