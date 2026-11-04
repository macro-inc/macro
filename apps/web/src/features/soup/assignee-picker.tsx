import { NO_ASSIGNEE } from '@app/features/next-soup/filters';
import type { SearchableOption } from '@app/features/next-soup/soup-view/filters-bar/searchable-multi-select';
import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import { useUserId } from '@core/context/user';
import type { IUser } from '@core/user/types';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import { useAgentAssignees } from '@property/queries/agent-assignees';
import { useTeamMembers } from '@property/queries/team-members';
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

/** A team roster with selected outsiders retained until explicitly removed. */
export function useAssigneePicker(
  activeIds: Accessor<string[]>,
  enabled: Accessor<boolean>
) {
  const team = useTeamMembers(enabled);
  const agents = useAgentAssignees(enabled);
  const userId = useUserId();
  const [selectedIdsAtViewEntry, setSelectedIdsAtViewEntry] = createSignal(
    new Set(activeIds())
  );
  const onOpenChange = (open: boolean) => {
    if (open) setSelectedIdsAtViewEntry(new Set(activeIds()));
  };

  const options = createMemo(() => {
    const uid = userId();
    const selectedIds = selectedIdsAtViewEntry();
    const people = new Map<string, IUser>();
    for (const member of team.users()) people.set(member.id, member);
    for (const agent of agents()) people.set(agent.id, agent);
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

    for (const agent of agents()) add(agent.id);
    if (uid) add(uid);
    result.push({
      id: NO_ASSIGNEE,
      label: t('viewMenus.unassigned'),
      icon: () => <CircleDashedIcon class="size-3.5 text-ink-muted" />,
    });
    for (const member of team.users()) add(member.id);
    for (const id of activeIds()) {
      if (id !== NO_ASSIGNEE) add(id);
    }
    return result.toSorted(
      (a, b) =>
        Number(selectedIds.has(b.id)) - Number(selectedIds.has(a.id)) ||
        Number(isBotPrincipalId(b.id)) - Number(isBotPrincipalId(a.id))
    );
  });
  return {
    options,
    onOpenChange,
    selectedIdsAtViewEntry,
    placeholder: () => t('viewMenus.searchAssignees'),
    isLoading: team.isLoading,
    isError: team.isError,
  };
}

export type AssigneePicker = ReturnType<typeof useAssigneePicker>;

export function AssigneePickerStatus(props: { picker: AssigneePicker }) {
  return (
    <>
      <Show when={props.picker.isLoading()}>
        <div class="px-2 py-1 text-xs text-ink-muted">
          {t('viewMenus.loadingTeamMembers')}
        </div>
      </Show>
      <Show when={props.picker.isError()}>
        <div class="px-2 py-1 text-xs text-ink-muted">
          {t('viewMenus.teamMembersUnavailable')}
        </div>
      </Show>
    </>
  );
}
