import CircleDashedIcon from '@icon/regular/circle-dashed.svg';
import { createMemo } from 'solid-js';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { UserIcon } from '@core/component/UserIcon';
import { useContacts } from '@queries/contacts/contacts';
import { useUserId } from '@core/context/user';
import { NO_ASSIGNEE } from '@app/component/next-soup/soup-view/task-sub-filter-matcher';
import { FilterCombobox, type Option } from './filter-primitives';

/**
 * Self-contained assignee filter that uses the soup view context.
 * Includes "No Assignee" option at the top, followed by contacts.
 */
export const AssigneeFilter = () => {
  const { assigneeFilter, setAssigneeFilter } = useSoupView();
  const contacts = useContacts();
  const userId = useUserId();

  const assigneeOptions = createMemo((): Option[] => {
    const currentUserId = userId();
    const noAssigneeOption: Option = {
      value: NO_ASSIGNEE,
      label: 'No Assignee',
      icon: () => <CircleDashedIcon class="size-4 text-ink-muted" />,
    };
    const contactOptions = contacts().map((contact) => ({
      value: contact.id,
      label:
        contact.id === currentUserId
          ? contact.name
            ? `${contact.name} (me)`
            : 'Me'
          : contact.name || contact.id,
      icon: () => (
        <UserIcon id={contact.id} size="xs" suppressClick showTooltip={false} />
      ),
    }));
    return [noAssigneeOption, ...contactOptions];
  });

  const activeAssignee = createMemo((): Option[] => {
    const current = assigneeFilter();
    const options = assigneeOptions();
    return options.filter((o) => current.includes(o.value));
  });

  const handleAssigneeChange = (options: Option[]) => {
    setAssigneeFilter(options.map((o) => o.value));
  };

  return (
    <FilterCombobox
      label="Assignee"
      options={assigneeOptions()}
      active={activeAssignee()}
      onChange={handleAssigneeChange}
      placeholder="Search assignees..."
      displayLimit={3}
      overflowLabel="assignees"
    />
  );
};
