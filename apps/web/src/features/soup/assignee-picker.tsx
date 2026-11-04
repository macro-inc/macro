import { NO_ASSIGNEE } from '@app/features/next-soup/filters';
import type {
  SearchableOption,
  SearchableSelectAction,
  SearchableSelectNavigation,
} from '@app/features/next-soup/soup-view/filters-bar/searchable-multi-select';
import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import { useUserId } from '@core/context/user';
import type { IUser } from '@core/user/types';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import { nonTeamUserOptions } from '@property/editors/selectors/scoped-user-options';
import { useAgentAssignees } from '@property/queries/agent-assignees';
import { useTeamMembers } from '@property/queries/team-members';
import { useContacts, useContactsQuery } from '@queries/contacts/contacts';
import { Button } from '@ui';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';

export function buildContactLabel(
  contact: { id: string; name?: string | null },
  currentUserId: string | undefined
): string {
  if (contact.id === currentUserId) {
    return contact.name
      ? t('viewMenus.contactMe', { name: contact.name })
      : t('viewMenus.me');
  }
  return contact.name || contact.id;
}

/** A team roster first, with selected outsiders retained until explicitly removed. */
export function useAssigneePicker(
  activeIds: Accessor<string[]>,
  enabled: Accessor<boolean>
) {
  const contacts = useContacts(enabled);
  const contactsQuery = useContactsQuery(enabled);
  const team = useTeamMembers(enabled);
  const agents = useAgentAssignees(enabled);
  const userId = useUserId();
  const [discovering, setDiscovering] = createSignal(false);
  const otherPeople = createMemo(() =>
    nonTeamUserOptions(team.users(), contacts())
  );

  const buildOptions = (discovering: boolean) => {
    const uid = userId();
    const selectedIds = new Set(activeIds());
    const people = new Map<string, IUser>();
    for (const contact of contacts()) people.set(contact.id, contact);
    for (const member of team.users()) people.set(member.id, member);
    for (const agent of agents()) people.set(agent.id, agent);
    const rosterIds = new Set(team.users().map((member) => member.id));
    const visible = new Set<string>();
    const result: SearchableOption[] = [];
    const add = (id: string) => {
      if (visible.has(id)) return;
      visible.add(id);
      result.push({
        id,
        label: buildContactLabel(people.get(id) ?? { id }, uid),
        icon: () => (
          <UserIcon id={id} size="sm" suppressClick showTooltip={false} />
        ),
      });
    };

    if (discovering) {
      if (!team.isLoading() && !team.isError()) {
        for (const contact of otherPeople()) {
          if (contact.id !== uid) add(contact.id);
        }
        for (const id of activeIds()) {
          if (
            id !== NO_ASSIGNEE &&
            id !== uid &&
            !rosterIds.has(id) &&
            !isBotPrincipalId(id)
          )
            add(id);
        }
      }
    } else {
      for (const agent of agents()) add(agent.id);
      if (uid) add(uid);
      result.push({
        id: NO_ASSIGNEE,
        label: t('viewMenus.unassigned'),
        icon: () => <CircleDashedIcon class="size-3.5 text-ink-muted" />,
      });
      for (const id of activeIds()) {
        if (id !== NO_ASSIGNEE) add(id);
      }
      for (const member of team.users()) add(member.id);
    }
    return result.toSorted(
      (a, b) =>
        Number(selectedIds.has(b.id)) - Number(selectedIds.has(a.id)) ||
        Number(isBotPrincipalId(b.id)) - Number(isBotPrincipalId(a.id))
    );
  };
  const mainOptions = createMemo(() => buildOptions(false));
  const otherOptions = createMemo(() => buildOptions(true));
  const allOptions = createMemo(() => [
    ...new Map(
      [...mainOptions(), ...otherOptions()].map((option) => [option.id, option])
    ).values(),
  ]);

  return {
    options: () => (discovering() ? otherOptions() : mainOptions()),
    allOptions,
    discovering,
    setDiscovering,
    placeholder: () =>
      t(
        discovering()
          ? 'viewMenus.searchOtherPeople'
          : 'viewMenus.searchAssignees'
      ),
    navigation: (): SearchableSelectNavigation => ({
      view: discovering() ? 1 : 0,
      back: discovering()
        ? {
            label: t('viewMenus.backToAssignees'),
            onSelect: () => setDiscovering(false),
          }
        : undefined,
    }),
    action: (): SearchableSelectAction | undefined =>
      discovering()
        ? undefined
        : {
            label: t('viewMenus.findOtherPeople'),
            onSelect: () => setDiscovering(true),
            closeOnSelect: false,
            class: 'w-fit',
          },
    isLoading: team.isLoading,
    isError: team.isError,
    otherPeopleEmpty: () =>
      contactsQuery.isSuccess && otherOptions().length === 0,
  };
}

export type AssigneeDiscovery = ReturnType<typeof useAssigneePicker>;

export function AssigneeDiscoveryControls(props: {
  discovery: AssigneeDiscovery;
  onDiscover?: () => void;
}) {
  return (
    <div class="border-t border-edge-muted p-1">
      <Show when={props.discovery.action()}>
        {(action) => (
          <Button
            variant="ghost"
            size="sm"
            class="w-fit"
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={props.onDiscover ?? action().onSelect}
          >
            {action().label}
          </Button>
        )}
      </Show>
      <AssigneeDiscoveryStatus discovery={props.discovery} />
    </div>
  );
}

export function AssigneeDiscoveryStatus(props: {
  discovery: AssigneeDiscovery;
}) {
  return (
    <>
      <Show when={props.discovery.isLoading()}>
        <div class="px-2 py-1 text-xs text-ink-muted">
          {t('viewMenus.loadingTeamMembers')}
        </div>
      </Show>
      <Show when={props.discovery.isError()}>
        <div class="px-2 py-1 text-xs text-ink-muted">
          {t('viewMenus.teamMembersUnavailable')}
        </div>
      </Show>
      <Show
        when={
          props.discovery.discovering() &&
          !props.discovery.isLoading() &&
          !props.discovery.isError() &&
          props.discovery.otherPeopleEmpty()
        }
      >
        <div role="status" class="px-2 py-1 text-xs text-ink-muted">
          {t('viewMenus.noOtherPeople')}
        </div>
      </Show>
    </>
  );
}
