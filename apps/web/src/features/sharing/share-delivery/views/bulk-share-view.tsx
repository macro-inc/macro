import { SendAsGroupToggle } from '@core/component/SendAsGroupToggle';
import { ShareComposeLayout } from '@core/component/ShareComposeLayout';
import { toast } from '@core/component/Toast/Toast';
import { ShareOptions } from '@core/component/TopBar/ShareButton';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import PaperPlaneTilt from '@phosphor/paper-plane-tilt.svg';
import { Button, Dialog, Hotkey, Panel } from '@ui';
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
  focusMessage: () => void;
  recipientName: (recipient: Recipient) => string;
  onSubmitted: () => void;
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
    if (!result) return;
    props.onSubmitted();
    if (!result.outcome.complete) return;
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
    <Panel depth={2} class="rounded-xl bg-dialog">
      <Panel.Header class="px-4">
        <Dialog.Title class="min-w-0 truncate text-sm font-medium">
          {`Share ${props.count} items`}
        </Dialog.Title>
      </Panel.Header>
      <Panel.Body>
        <div ref={root}>
          <div class="border-b border-edge-muted px-4 py-2">
            {props.selection}
          </div>
          <ShareComposeLayout
            recipients={props.recipientField}
            access={
              <Show when={props.form.level()}>
                {(level) => (
                  <>
                    <Show when={props.form.recipients().length > 0}>
                      <span class="text-sm text-ink-extra-muted">can</span>
                    </Show>
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
                      noBorder
                      disabled={props.form.locked()}
                    />
                  </>
                )}
              </Show>
            }
            message={props.messageField}
            focusMessage={props.focusMessage}
            status={
              <Show
                when={report()}
                fallback={<ShareNotices notices={props.form.notices()} />}
              >
                {(outcome) => (
                  <ShareReport outcome={outcome()} recipientName={targetName} />
                )}
              </Show>
            }
            group={
              <Show when={props.form.group()}>
                {(group) => (
                  <SendAsGroupToggle
                    on={group().on}
                    locked={props.form.locked()}
                    onChange={props.form.setGroup}
                  />
                )}
              </Show>
            }
            actions={
              <Show
                when={!settled()}
                fallback={
                  <Button variant="strong" depth={3} onClick={props.onFinish}>
                    Done
                    <Hotkey shortcut="cmd+enter" theme="current" />
                  </Button>
                }
              >
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-ink-extra-muted"
                  onClick={dismiss}
                >
                  {report() ? 'Close' : 'Cancel'}
                </Button>
                <Button
                  variant="strong"
                  depth={3}
                  disabled={
                    props.form.recipients().length === 0 ||
                    !props.form.sendable() ||
                    sending()
                  }
                  onClick={() => void share()}
                >
                  <PaperPlaneTilt class="size-4" />
                  {report() ? 'Retry' : 'Share'}
                  <Hotkey shortcut="cmd+enter" theme="current" />
                </Button>
              </Show>
            }
          />
        </div>
      </Panel.Body>
    </Panel>
  );
}
