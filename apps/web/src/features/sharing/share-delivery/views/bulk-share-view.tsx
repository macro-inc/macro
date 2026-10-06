import { SendAsGroupToggle } from '@core/component/SendAsGroupToggle';
import { toast } from '@core/component/Toast/Toast';
import { ShareOptions } from '@core/component/TopBar/ShareButton';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { ActionDialogShell, Button, Hotkey } from '@ui';
import { type JSX, onMount, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { ShareNotices, ShareReport } from '../components/share-status';
import type { PickedRecipient, ShareTarget } from '../core/delivery-plan';
import { parseChannelAccessLevel } from '../core/share-item';
import type { ShareForm } from '../primitives/create-share-form';

export type BulkShareHandle = {
  readonly dismiss: () => void;
};

export function BulkShareView<Recipient extends PickedRecipient>(props: {
  form: ShareForm<Recipient>;
  count: number;
  selection: JSX.Element;
  recipientField: JSX.Element;
  messageField: JSX.Element;
  recipientName: (recipient: Recipient) => string;
  onFinish: () => void;
  onCancel: () => void;
  ref?: (handle: BulkShareHandle) => void;
}) {
  let root!: HTMLDivElement;
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('bulk-share', true);
  const report = () =>
    match(props.form.status())
      .with({ t: 'editing' }, () => undefined)
      .with({ t: 'sending' }, ({ previousOutcome }) => previousOutcome)
      .with({ t: 'incomplete' }, { t: 'complete' }, ({ outcome }) => outcome)
      .exhaustive();
  const sending = () => props.form.status().t === 'sending';
  const settled = () => report()?.retryable === false;
  const dismiss = () =>
    report()?.anyDelivered ? props.onFinish() : props.onCancel();

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
    if (!result?.outcome.complete) return;
    const { outcome, open } = result;
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
      if (event?.repeat) return true;
      if (settled()) props.onFinish();
      else void share();
      return true;
    },
  });

  onMount(() => {
    attachHotkeys(root);
    props.ref?.({ dismiss });
  });

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
          <Button variant="ghost" onClick={dismiss}>
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
