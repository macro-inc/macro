import { t } from '@app/lib/i18n';
import XIcon from '@icon/system/regular/x.svg';
import { useCreateSubteamMutation } from '@queries/team/subteams';
import type { Subteam } from '@service-auth/generated/schemas/subteam';
import type { SubteamColor } from '@service-auth/generated/schemas/subteamColor';
import { SubteamJoinPolicy } from '@service-auth/generated/schemas/subteamJoinPolicy';
import { Button, Dialog, Panel } from '@ui';
import { createSignal } from 'solid-js';
import {
  SUBTEAM_COLORS,
  SubteamColorPicker,
  SubteamMark,
} from './subteam-mark';
import { SubteamPeoplePicker } from './subteam-people-picker';

const NAME_MAX_LENGTH = 40;

/** Names a new team and picks its people; the creator manages it. */
export function NewSubteamDialog(props: {
  open: boolean;
  /** Workspace members other than the viewer. */
  userIds: string[];
  /** How many teams exist, to pick the next color. */
  existingCount: number;
  onClose: () => void;
  onCreated: (subteam: Subteam) => void;
}) {
  const createSubteam = useCreateSubteamMutation();
  const [name, setName] = createSignal('');
  const [pickedColor, setPickedColor] = createSignal<SubteamColor>();
  const color = () =>
    pickedColor() ??
    SUBTEAM_COLORS[props.existingCount % SUBTEAM_COLORS.length];
  const [selected, setSelected] = createSignal<string[]>([]);

  const close = () => {
    setName('');
    setPickedColor(undefined);
    setSelected([]);
    props.onClose();
  };

  const create = () => {
    const trimmed = name().trim();
    if (!trimmed) return;

    createSubteam.mutate(
      {
        name: trimmed,
        color: color(),
        joinPolicy: SubteamJoinPolicy.open,
        memberIds: selected(),
      },
      {
        onSuccess: (subteam) => {
          close();
          props.onCreated(subteam);
        },
      }
    );
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && close()}>
      <Panel depth={2} class="max-h-[75vh] rounded-xl text-ink">
        <Panel.Header class="gap-1 px-2">
          <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
            <XIcon class="pointer-events-none size-3.5 shrink-0 touch:size-6" />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
            {t('settingsTeams.newTeam')}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="flex flex-col gap-4 p-3">
          <div class="flex items-end gap-3">
            <SubteamMark name={name()} color={color()} size="lg" />
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <div class="flex items-center justify-between">
                <label class="text-sm text-ink-muted" for="new-subteam-name">
                  {t('settingsTeams.name')}
                </label>
                <span class="text-xs text-ink-muted">
                  {name().length}/{NAME_MAX_LENGTH}
                </span>
              </div>
              <input
                id="new-subteam-name"
                type="text"
                maxLength={NAME_MAX_LENGTH}
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
                onKeyDown={(event) => event.key === 'Enter' && create()}
                placeholder={t('settingsTeams.namePlaceholder')}
                class="settings-input w-full"
              />
            </div>
          </div>
          <SubteamColorPicker value={color()} onChange={setPickedColor} />
          <SubteamPeoplePicker
            userIds={props.userIds}
            selected={selected()}
            onChange={setSelected}
          />
          <div class="flex justify-end gap-1 pt-1">
            <Button
              variant="ghost"
              disabled={createSubteam.isPending}
              onClick={close}
            >
              {t('settingsTeams.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!name().trim() || createSubteam.isPending}
              onClick={create}
            >
              {t('settingsTeams.create')}
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
