import { NO_ASSIGNEE } from '@app/features/next-soup/filters';
import type { SearchableOption } from '@app/features/next-soup/soup-view/filters-bar/searchable-multi-select';
import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import { peopleBeforeAgents } from '@core/user/people-before-agents';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import { useAgentAssignees } from '@property/queries/agent-assignees';
import { useTeamMembers } from '@queries/team/members';
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
  const [selectedIdsAtViewEntry, setSelectedIdsAtViewEntry] = createSignal([
    ...activeIds(),
  ]);
  const onOpenChange = (open: boolean) => {
    if (open) setSelectedIdsAtViewEntry([...activeIds()]);
  };

  const options = createMemo(
    () => {
      const uid = userId();
      const people = [...team.users(), ...agents()];
      const result: SearchableOption[] = [];
      const add = (id: string) => {
        if (result.some((option) => option.id === id)) return;

        // Selected people outside the roster (a filter applied from a task's
        // assignee) are named from the shared name cache, never shown as an id.
        const person = people.find((user) => user.id === id) ?? {
          id,
          name: getDisplayName(tryMacroId(id)),
        };
        result.push({
          id,
          label: buildContactLabel(person, uid),
          icon: () => (
            <UserIcon id={id} size="sm" suppressClick showTooltip={false} />
          ),
        });
      };

      if (uid) add(uid);
      result.push({
        id: NO_ASSIGNEE,
        label: t('viewMenus.unassigned'),
        icon: () => <CircleDashedIcon class="size-3.5 text-ink-muted" />,
      });
      for (const person of people) add(person.id);
      for (const id of selectedIdsAtViewEntry()) {
        if (id !== NO_ASSIGNEE) add(id);
      }
      for (const id of activeIds()) {
        if (id !== NO_ASSIGNEE) add(id);
      }
      return peopleBeforeAgents(result, (option) => option.id, {
        viewerId: uid,
      });
    },
    undefined,
    {
      // Selecting a roster member does not change the rows or their order.
      equals: (previous, next) => {
        if (previous.length !== next.length) return false;

        return previous.every((option, index) => {
          const nextOption = next[index];
          return (
            option.id === nextOption.id && option.label === nextOption.label
          );
        });
      },
    }
  );
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
