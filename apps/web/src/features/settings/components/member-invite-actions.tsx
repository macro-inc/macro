import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { ButtonGroup, Dropdown } from '@ui';
import { Show } from 'solid-js';

export function MemberInviteActions(props: {
  canInvitePeople: boolean;
  canInviteAgents: boolean;
  onInvitePerson(): void;
  onInviteAgent(): void;
}) {
  return (
    <div class="flex items-center gap-2" data-member-invite-actions>
      <Show when={props.canInviteAgents}>
        <HeaderActionGroup label={t('common.agentInvitation')} size="md">
          <ButtonGroup.Button
            variant="secondary"
            size="md"
            onClick={props.onInviteAgent}
          >
            {t('common.inviteAgent')}
          </ButtonGroup.Button>
        </HeaderActionGroup>
      </Show>
      <Show when={props.canInvitePeople}>
        <ButtonGroup
          size="md"
          variant="secondary"
          finish="raised"
          aria-label={t('common.invite')}
        >
          <ButtonGroup.Button onClick={props.onInvitePerson}>
            <PlusIcon class="size-4" /> {t('common.invite')}
          </ButtonGroup.Button>
          <ButtonGroup.Divider />
          <Dropdown>
            <Dropdown.Trigger
              as={ButtonGroup.Button}
              size="icon-md"
              aria-label={t('common.inviteOptions')}
            >
              <CaretDownIcon class="size-4" />
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.Item onSelect={props.onInvitePerson}>
                {t('common.invitePerson')}
              </Dropdown.Item>
              <Show when={props.canInviteAgents}>
                <Dropdown.Item onSelect={props.onInviteAgent}>
                  {t('common.inviteAnAgent')}
                </Dropdown.Item>
              </Show>
            </Dropdown.Content>
          </Dropdown>
        </ButtonGroup>
      </Show>
    </div>
  );
}
