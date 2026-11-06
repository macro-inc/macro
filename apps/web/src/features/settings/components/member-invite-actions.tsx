import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import { ButtonGroup, Dropdown } from '@ui';
import { Show } from 'solid-js';

export function MemberInviteActions(props: {
  canInvitePeople: boolean;
  canInviteAgents: boolean;
  onInvitePerson(): void;
  onInviteAgent(): void;
}) {
  let inviteTrigger: HTMLElement | undefined;
  let inviteAfterClose: (() => void) | undefined;
  return (
    <div class="flex items-center gap-2" data-member-invite-actions>
      <Show when={props.canInviteAgents}>
        <HeaderActionGroup label={t('common.agentInvitation')} size="md">
          <ButtonGroup.Button
            variant="secondary"
            size="md"
            onClick={() => props.canInviteAgents && props.onInviteAgent()}
          >
            <RobotIcon class="size-4" />
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
          <ButtonGroup.Button
            variant="secondary"
            size="md"
            onClick={props.onInvitePerson}
          >
            <PlusIcon class="size-4" /> {t('common.invite')}
          </ButtonGroup.Button>
          <ButtonGroup.Divider />
          <Dropdown placement="bottom-end" gutter={8}>
            <Dropdown.Trigger
              as={ButtonGroup.Button}
              variant="secondary"
              size="icon-md"
              aria-label={t('common.inviteOptions')}
              ref={(element) => {
                inviteTrigger = element;
              }}
            >
              <CaretDownIcon class="size-4" />
            </Dropdown.Trigger>
            <Dropdown.Content
              class="min-w-72 max-w-[calc(100vw-16px)]"
              onCloseAutoFocus={(event) => {
                const action = inviteAfterClose;
                inviteAfterClose = undefined;
                if (!action || !inviteTrigger?.isConnected) return;
                event.preventDefault();
                inviteTrigger.focus();
                action();
              }}
            >
              <Dropdown.Item
                onSelect={() => {
                  inviteAfterClose = () => {
                    if (props.canInvitePeople) props.onInvitePerson();
                  };
                }}
                textValue={t('common.invitePerson')}
                aria-label={t('common.invitePerson')}
              >
                <UserPlusIcon class="size-4 shrink-0" />
                <div class="min-w-0">
                  <Dropdown.ItemLabel>
                    {t('common.invitePerson')}
                  </Dropdown.ItemLabel>
                  <Dropdown.ItemDescription class="block text-xs text-ink-muted">
                    {t('common.invitePersonDescription')}
                  </Dropdown.ItemDescription>
                </div>
              </Dropdown.Item>
              <Show when={props.canInviteAgents}>
                <Dropdown.Item
                  onSelect={() => {
                    inviteAfterClose = () => {
                      if (props.canInviteAgents) props.onInviteAgent();
                    };
                  }}
                  textValue={t('common.inviteAnAgent')}
                  aria-label={t('common.inviteAnAgent')}
                >
                  <RobotIcon class="size-4 shrink-0" />
                  <div class="min-w-0">
                    <Dropdown.ItemLabel>
                      {t('common.inviteAnAgent')}
                    </Dropdown.ItemLabel>
                    <Dropdown.ItemDescription class="block text-xs text-ink-muted">
                      {t('common.inviteAgentDescription')}
                    </Dropdown.ItemDescription>
                  </div>
                </Dropdown.Item>
              </Show>
            </Dropdown.Content>
          </Dropdown>
        </ButtonGroup>
      </Show>
    </div>
  );
}
