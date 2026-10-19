import { SendAsGroupToggle } from '@core/component/SendAsGroupToggle';
import {
  MobileShareComposeLayout,
  ShareComposeLayout,
} from '@core/component/ShareComposeLayout';
import { toast } from '@core/component/Toast/Toast';
import { ShareOptions } from '@core/component/TopBar/ShareButton';
import {
  ShareDrawerAction,
  ShareDrawerHeader,
} from '@core/component/TopBar/ShareDrawer';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
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
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('bulk-share', true);
  const report = () =>
    match(props.form.status())
      .with({ t: 'editing' }, () => undefined)
      .with({ t: 'sending' }, ({ previousOutcome }) => previousOutcome)
      .with({ t: 'incomplete' }, { t: 'complete' }, ({ outcome }) => outcome)
      .exhaustive();
  const sending = () => props.form.status().t === 'sending';
  const settled = () => report()?.retryable === false;
  const canShare = () =>
    props.form.recipients().length > 0 && props.form.sendable() && !sending();
  const dismiss = () =>
    report()?.anyDelivered ? props.onFinish() : props.onCancel();
  const title = () => `Share ${props.count} items`;

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

  const send = () => {
    if (settled()) props.onFinish();
    else fireAndForget(share(), 'bulk-share');
  };

  const setLevel = (accessLevel: string | null) => {
    const parsed = accessLevel && parseChannelAccessLevel(accessLevel);
    if (parsed) props.form.setLevel(parsed);
  };

  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId,
    description: 'Share',
    runWithInputFocused: true,
    keyDownHandler: (event) => {
      if (event?.repeat) return true;
      send();
      return true;
    },
  });

  onMount(() => props.ref?.({ dismiss }));

  const status = () => (
    <Show
      when={report()}
      fallback={<ShareNotices notices={props.form.notices()} />}
    >
      {(outcome) => (
        <ShareReport outcome={outcome()} recipientName={targetName} />
      )}
    </Show>
  );
  const groupToggle = () => (
    <Show when={props.form.group()}>
      {(group) => (
        <SendAsGroupToggle
          on={group().on}
          locked={props.form.locked()}
          onChange={props.form.setGroup}
        />
      )}
    </Show>
  );

  return (
    <Show
      when={!isMobile()}
      fallback={
        <>
          <ShareDrawerHeader
            action={
              <ShareDrawerAction
                disabled={!settled() && !canShare()}
                onClick={send}
              >
                {settled() ? 'Done' : report() ? 'Retry' : 'Share'}
              </ShareDrawerAction>
            }
          >
            <span class="truncate">{title()}</span>
          </ShareDrawerHeader>
          <div ref={attachHotkeys}>
            <div class="border-b border-edge-muted px-3 pb-2 mb-2">
              {props.selection}
            </div>
            <MobileShareComposeLayout
              recipients={props.recipientField}
              group={groupToggle()}
              access={
                <Show when={props.form.level()}>
                  {(level) => (
                    <ShareOptions
                      allowedAccessLevels={level().options}
                      permissions={level().value}
                      setPermissions={setLevel}
                      label="Permission"
                      hideNoAccess
                      disabled={props.form.locked()}
                    />
                  )}
                </Show>
              }
              status={status()}
              message={props.messageField}
              focusMessage={props.focusMessage}
            />
          </div>
        </>
      }
    >
      <Panel depth={2} class="rounded-xl bg-dialog">
        <Panel.Header class="px-4">
          <Dialog.Title class="min-w-0 truncate text-sm font-medium">
            {title()}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body>
          <div ref={attachHotkeys}>
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
                        setPermissions={setLevel}
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
              status={status()}
              group={groupToggle()}
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
                    disabled={!canShare()}
                    onClick={() => fireAndForget(share(), 'bulk-share')}
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
    </Show>
  );
}
