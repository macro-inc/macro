import { t } from '@app/lib/i18n';
import {
  ActionDialogShell,
  Button,
  Checkbox,
  Dialog,
  type ManagedDialogProps,
  type OpenDialogOptions,
  openDialog,
} from '@ui';
import { createSignal, For } from 'solid-js';

type SectionConflictProps = {
  sectionName: string;
  /** What changed on the section: its kinds, or a mute or snooze. */
  change: 'kinds' | 'mute';
  /** The section's channels the change won't reach. */
  channels: readonly { id: string; name: string }[];
  /** Save the section change, and drop the overrides of `overrideIds`. */
  onConfirm: (overrideIds: string[]) => void;
};

function SectionConflictDialog(
  props: ManagedDialogProps & SectionConflictProps
) {
  const [selected, setSelected] = createSignal<string[]>([]);

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) =>
      checked ? [...current, id] : current.filter((each) => each !== id)
    );

  const confirm = (overrideIds: string[]) => {
    props.onConfirm(overrideIds);
    props.onOpenChange(false);
  };

  const description = () =>
    t(
      props.change === 'mute'
        ? 'channelSections.sectionMuteConflictDescription'
        : 'channelSections.sectionConflictDescription',
      { count: props.channels.length, name: props.sectionName }
    );

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      class="w-full max-w-md"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          confirm([]);
        }}
      >
        <ActionDialogShell>
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>
                {t('channelSections.sectionConflictTitle')}
              </ActionDialogShell.Title>
              <ActionDialogShell.Description>
                {description()}
              </ActionDialogShell.Description>
            </ActionDialogShell.Header>
            <div class="flex max-h-64 flex-col overflow-y-auto">
              <For each={props.channels}>
                {(channel) => (
                  <Checkbox
                    class="flex w-full gap-2 rounded-lg px-2 py-2 not-touch:hover:bg-hover"
                    checked={selected().includes(channel.id)}
                    onChange={(checked) => toggle(channel.id, checked)}
                    data-conflict-channel={channel.id}
                  >
                    <Checkbox.Control />
                    <Checkbox.Label class="min-w-0 truncate text-sm">
                      {channel.name}
                    </Checkbox.Label>
                  </Checkbox>
                )}
              </For>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="self-start"
              disabled={selected().length === props.channels.length}
              onClick={() =>
                setSelected(props.channels.map((channel) => channel.id))
              }
            >
              {t('channelSections.sectionConflictSelectAll')}
            </Button>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button
              type="button"
              variant="ghost"
              onClick={() => props.onOpenChange(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={selected().length === 0}
              onClick={() => confirm(selected())}
            >
              {t('channelSections.sectionConflictOverride')}
            </Button>
            <Button type="submit" variant="primary">
              {t('channelSections.sectionConflictOk')}
            </Button>
          </ActionDialogShell.Footer>
        </ActionDialogShell>
      </form>
    </Dialog>
  );
}

/**
 * Ask what to do with a section's channels that have their own settings:
 * OK keeps them, Override makes the selected ones follow the section, and
 * Cancel saves nothing.
 */
export function openSectionConflict(
  props: SectionConflictProps,
  options?: OpenDialogOptions
) {
  openDialog(SectionConflictDialog, props, options);
}
