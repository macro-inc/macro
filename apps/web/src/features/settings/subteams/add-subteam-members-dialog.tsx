import { t } from '@app/lib/i18n';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Panel } from '@ui';
import { createSignal } from 'solid-js';
import { SubteamPeoplePicker } from './subteam-people-picker';

/** Picks workspace members to add to a team. */
export function AddSubteamMembersDialog(props: {
  open: boolean;
  /** Workspace members not on the team yet. */
  userIds: string[];
  onClose: () => void;
  onAdd: (userIds: string[]) => void;
}) {
  const [selected, setSelected] = createSignal<string[]>([]);

  const close = () => {
    setSelected([]);
    props.onClose();
  };

  const add = () => {
    props.onAdd(selected());
    close();
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && close()}>
      <Panel depth={2} class="max-h-[75vh] rounded-xl text-ink">
        <Panel.Header class="gap-1 px-2">
          <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
            <XIcon class="pointer-events-none size-3.5 shrink-0 touch:size-6" />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
            {t('settingsTeams.addPeople')}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="flex flex-col gap-4 p-3">
          <SubteamPeoplePicker
            userIds={props.userIds}
            selected={selected()}
            onChange={setSelected}
          />
          <div class="flex justify-end gap-1">
            <Button variant="ghost" onClick={close}>
              {t('settingsTeams.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={selected().length === 0}
              onClick={add}
            >
              {t('settingsTeams.add', { count: selected().length })}
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
