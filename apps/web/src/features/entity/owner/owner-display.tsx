import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { getDisplayName } from '@core/user';
import type { MacroId } from '@core/user/macroId';
import UsersThreeIcon from '@icon/system/regular/users-three.svg';
import { firstPartyBotName } from '@queries/bots/first-party-bot-name';
import { useBotProfile } from '@queries/bots/profiles';
import { queryReadyGate } from '@queries/gate';
import { useUserTeamsQuery } from '@queries/team/teams';
import { Avatar, cn } from '@ui';
import {
  type Accessor,
  type JSX,
  Match,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { botOwnerName, type Owner, parseOwner } from './owner';

function IconAndName(
  props: ParentProps<{
    name: string | undefined;
    title?: string;
    textOnly?: boolean;
    iconOnly?: boolean;
  }>
): JSX.Element {
  return (
    <span
      class="inline-flex min-w-0 items-center gap-1.5"
      title={props.title ?? (props.iconOnly ? props.name : undefined)}
    >
      <Show when={!props.textOnly}>{props.children}</Show>
      <Show when={props.name !== undefined}>
        <span class={props.iconOnly ? 'sr-only' : 'truncate'}>
          {props.name}
        </span>
      </Show>
    </span>
  );
}

function TeamBadge(props: {
  name: string;
  textOnly?: boolean;
  iconOnly?: boolean;
  iconClass?: string;
}): JSX.Element {
  return (
    <IconAndName
      name={props.name}
      title={props.name}
      textOnly={props.textOnly}
      iconOnly={props.iconOnly}
    >
      <UsersThreeIcon class={cn('size-4 shrink-0', props.iconClass)} />
    </IconAndName>
  );
}

function asKind<K extends Owner['kind']>(
  owner: Owner | undefined,
  kind: K
): Extract<Owner, { kind: K }> | undefined {
  return owner?.kind === kind
    ? (owner as Extract<Owner, { kind: K }>)
    : undefined;
}

function UserOwner(props: {
  id: MacroId;
  viewerLabel?: string;
  suppressClick?: boolean;
  showTooltip?: boolean;
  userAvatarOnly?: boolean;
  textOnly?: boolean;
  iconOnly?: boolean;
  iconClass?: string;
}): JSX.Element {
  const userId = useUserId();
  const name = () => {
    const label = props.viewerLabel;
    return label && props.id === userId() ? label : getDisplayName(props.id);
  };
  return (
    <IconAndName
      name={props.userAvatarOnly ? undefined : name()}
      textOnly={props.textOnly}
      iconOnly={props.iconOnly}
    >
      <UserIcon
        id={props.id}
        size="sm"
        class={props.iconClass}
        suppressClick={props.suppressClick}
        showTooltip={props.showTooltip}
      />
    </IconAndName>
  );
}

function BotFace(props: {
  principal: string;
  name: string;
  avatarUrl?: string;
  textOnly?: boolean;
  iconOnly?: boolean;
  iconClass?: string;
}): JSX.Element {
  return (
    <IconAndName
      name={props.name}
      textOnly={props.textOnly}
      iconOnly={props.iconOnly}
    >
      <UserIcon
        id={props.principal}
        photoUrl={props.avatarUrl}
        size="sm"
        class={props.iconClass}
      />
    </IconAndName>
  );
}

type BotProfileQuery = ReturnType<typeof useBotProfile>;

function profileBotName(profile: BotProfileQuery): string {
  const found = queryReadyGate(profile) ? profile.data : undefined;
  if (found) return botOwnerName(found);
  return found === null || profile.isError ? 'Bot' : '';
}

/**
 * A bot's display name, by bare UUID: first-party bots by constant, others
 * from their profile. Empty while the profile loads.
 */
export function useBotName(botId: Accessor<string>): Accessor<string> {
  const profile = useBotProfile(() =>
    firstPartyBotName(botId()) ? '' : botId()
  );
  return () => firstPartyBotName(botId()) ?? profileBotName(profile);
}

function ProfileBot(props: {
  botId: string;
  textOnly?: boolean;
  iconOnly?: boolean;
  iconClass?: string;
}): JSX.Element {
  const profile = useBotProfile(() => props.botId);
  const settled = () => (queryReadyGate(profile) ? profile.data : undefined);
  const name = () => profileBotName(profile);
  return (
    <BotFace
      principal={`bot|${props.botId}`}
      name={name()}
      avatarUrl={settled()?.avatarUrl}
      textOnly={props.textOnly}
      iconOnly={props.iconOnly}
      iconClass={props.iconClass}
    />
  );
}

function BotOwner(props: {
  botId: string;
  textOnly?: boolean;
  iconOnly?: boolean;
  iconClass?: string;
}): JSX.Element {
  const firstParty = () => firstPartyBotName(props.botId);
  return (
    <Show
      when={firstParty()}
      fallback={
        <ProfileBot
          botId={props.botId}
          textOnly={props.textOnly}
          iconOnly={props.iconOnly}
          iconClass={props.iconClass}
        />
      }
    >
      {(name) => (
        <BotFace
          principal={`bot|${props.botId}`}
          name={name()}
          textOnly={props.textOnly}
          iconOnly={props.iconOnly}
          iconClass={props.iconClass}
        />
      )}
    </Show>
  );
}

function TeamOwner(props: {
  teamId: string;
  textOnly?: boolean;
  iconOnly?: boolean;
  iconClass?: string;
}): JSX.Element {
  const teams = useUserTeamsQuery();
  const name = () => {
    if (queryReadyGate(teams)) {
      return (
        teams.data.find((team) => team.id === props.teamId)?.name ?? 'Team'
      );
    }
    return teams.isError ? 'Team' : '';
  };
  return (
    <TeamBadge
      name={name()}
      textOnly={props.textOnly}
      iconOnly={props.iconOnly}
      iconClass={props.iconClass}
    />
  );
}

function UnknownOwner(props: {
  textOnly?: boolean;
  iconOnly?: boolean;
  iconClass?: string;
}): JSX.Element {
  return (
    <IconAndName
      name="Unknown"
      textOnly={props.textOnly}
      iconOnly={props.iconOnly}
    >
      <Avatar size="sm" class={props.iconClass}>
        <Avatar.Fallback>?</Avatar.Fallback>
      </Avatar>
    </IconAndName>
  );
}

/**
 * An owner's avatar and name, for every owner kind. A user keeps `UserIcon`'s
 * DM click and tooltip unless the caller turns them off. A bot never opens a
 * DM, and a team renders a team badge rather than a person. Renders nothing
 * without an owner.
 */
export function OwnerLabel(props: {
  ownerId: string | undefined;
  /** Replaces the viewer's own name, such as "Me". */
  viewerLabel?: string;
  suppressClick?: boolean;
  showTooltip?: boolean;
  userAvatarOnly?: boolean;
  textOnly?: boolean;
  /** Show only the owner icon, retaining the name for assistive technology. */
  iconOnly?: boolean;
  /** Size or style the rendered icon without changing the label layout. */
  iconClass?: string;
}): JSX.Element {
  const owner = () => parseOwner(props.ownerId);
  return (
    <Switch>
      <Match when={asKind(owner(), 'user')}>
        {(user) => (
          <UserOwner
            id={user().id}
            viewerLabel={props.viewerLabel}
            suppressClick={props.suppressClick}
            showTooltip={props.showTooltip}
            userAvatarOnly={props.userAvatarOnly}
            textOnly={props.textOnly}
            iconOnly={props.iconOnly}
            iconClass={props.iconClass}
          />
        )}
      </Match>
      <Match when={asKind(owner(), 'bot')}>
        {(bot) => (
          <BotOwner
            botId={bot().botId}
            textOnly={props.textOnly}
            iconOnly={props.iconOnly}
            iconClass={props.iconClass}
          />
        )}
      </Match>
      <Match when={asKind(owner(), 'team')}>
        {(team) => (
          <TeamOwner
            teamId={team().teamId}
            textOnly={props.textOnly}
            iconOnly={props.iconOnly}
            iconClass={props.iconClass}
          />
        )}
      </Match>
      <Match when={asKind(owner(), 'unknown')}>
        <UnknownOwner
          textOnly={props.textOnly}
          iconOnly={props.iconOnly}
          iconClass={props.iconClass}
        />
      </Match>
    </Switch>
  );
}
