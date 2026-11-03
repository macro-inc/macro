import { NO_ASSIGNEE } from '@app/features/next-soup/filters';
import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import type { IUser } from '@core/user/types';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import { useTeamMembers } from '@property/queries/team-members';
import { useContacts } from '@queries/contacts/contacts';
import { Button } from '@ui';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';
import type {
  SearchableOption,
  SearchableSelectAction,
} from './searchable-multi-select';

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
  const team = useTeamMembers(enabled);
  const userId = useUserId();
  const [discovering, setDiscovering] = createSignal(false);

  const options = createMemo(() => {
    const uid = userId();
    const people = new Map<string, IUser>();
    for (const contact of contacts()) people.set(contact.id, contact);
    for (const member of team.users()) people.set(member.id, member);

    const option = (id: string): SearchableOption => ({
      id,
      label: buildContactLabel(people.get(id) ?? { id }, uid),
      icon: () => (
        <UserIcon id={id} size="sm" suppressClick showTooltip={false} />
      ),
    });
    const visible = new Set<string>();
    const result: SearchableOption[] = [];
    const add = (id: string) => {
      if (visible.has(id)) return;
      visible.add(id);
      result.push(option(id));
    };

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
    if (discovering()) {
      for (const contact of contacts()) add(contact.id);
    }
    return result;
  });

  return {
    options,
    discovering,
    setDiscovering,
    action: (): SearchableSelectAction => ({
      label: discovering()
        ? t('viewMenus.backToTeam')
        : t('viewMenus.findOtherPeople'),
      onSelect: () => setDiscovering((value) => !value),
      closeOnSelect: false,
    }),
    isLoading: team.isLoading,
    isError: team.isError,
  };
}

export type AssigneeDiscovery = ReturnType<typeof useAssigneePicker>;

export function AssigneeDiscoveryControls(props: {
  discovery: AssigneeDiscovery;
}) {
  return (
    <div class="border-t border-edge-muted p-1">
      <Button
        variant="ghost"
        size="sm"
        fullWidth
        class="justify-start"
        onPointerDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => props.discovery.action().onSelect()}
      >
        {props.discovery.action().label}
      </Button>
      <AssigneeDiscoveryStatus discovery={props.discovery} />
    </div>
  );
}

export function AssigneeDiscoveryStatus(props: {
  discovery: AssigneeDiscovery;
}) {
  return (
    <>
      <Show
        when={!props.discovery.discovering() && props.discovery.isLoading()}
      >
        <div class="px-2 py-1 text-xs text-ink-muted">
          {t('viewMenus.loadingTeamMembers')}
        </div>
      </Show>
      <Show when={!props.discovery.discovering() && props.discovery.isError()}>
        <div class="px-2 py-1 text-xs text-ink-muted">
          {t('viewMenus.teamMembersUnavailable')}
        </div>
      </Show>
    </>
  );
}
