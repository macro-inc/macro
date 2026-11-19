import { t } from '@app/lib/i18n';
import type { ChannelNotificationKind } from '@service-notification/generated/schemas/channelNotificationKind';
import {
  ActionDialogShell,
  Button,
  Checkbox,
  Dialog,
  type ManagedDialogProps,
  openDialog,
} from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { notificationKindLabel } from './components/notification-settings-labels';
import { CHANNEL_NOTIFICATION_KINDS } from './core/channel-notification-settings';

type CustomNotificationSettingsProps = {
  /** The channel or section the settings are for. */
  targetName: string;
  enabled: ReadonlySet<ChannelNotificationKind>;
  /** Where a channel's settings come from: "This channel" or "Inherited from …". */
  source?: string;
  onSave: (kinds: ReadonlySet<ChannelNotificationKind>) => void;
};

function CustomNotificationSettingsDialog(
  props: ManagedDialogProps & CustomNotificationSettingsProps
) {
  const [kinds, setKinds] = createSignal<ChannelNotificationKind[]>(
    CHANNEL_NOTIFICATION_KINDS.filter((kind) => props.enabled.has(kind))
  );

  const toggle = (kind: ChannelNotificationKind, checked: boolean) =>
    setKinds((current) =>
      checked
        ? [...current, kind]
        : current.filter((existing) => existing !== kind)
    );

  const save = () => {
    props.onSave(new Set(kinds()));
    props.onOpenChange(false);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      class="w-full max-w-sm"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <ActionDialogShell>
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>
                {t('channelSections.customNotificationsTitle')}
              </ActionDialogShell.Title>
              <ActionDialogShell.Description>
                {t('channelSections.customNotificationsDescription', {
                  name: props.targetName,
                })}
              </ActionDialogShell.Description>
            </ActionDialogShell.Header>
            <Show when={props.source}>
              {(source) => (
                <div
                  class="px-2 text-xs text-ink-muted"
                  data-notification-settings-source
                >
                  {source()}
                </div>
              )}
            </Show>
            <div class="flex flex-col">
              <For each={CHANNEL_NOTIFICATION_KINDS}>
                {(kind) => (
                  <Checkbox
                    class="flex w-full gap-2 rounded-lg px-2 py-2 not-touch:hover:bg-hover"
                    checked={kinds().includes(kind)}
                    onChange={(checked) => toggle(kind, checked)}
                  >
                    <Checkbox.Control />
                    <Checkbox.Label class="text-sm">
                      {notificationKindLabel(kind)}
                    </Checkbox.Label>
                  </Checkbox>
                )}
              </For>
            </div>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button
              type="button"
              variant="ghost"
              onClick={() => props.onOpenChange(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary">
              {t('channelSections.customNotificationsSave')}
            </Button>
          </ActionDialogShell.Footer>
        </ActionDialogShell>
      </form>
    </Dialog>
  );
}

/** The six notification kinds as checkboxes, saved together as a full set. */
export function openCustomNotificationSettings(
  props: CustomNotificationSettingsProps
) {
  openDialog(CustomNotificationSettingsDialog, props);
}
