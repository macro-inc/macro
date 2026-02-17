type AssigneeOption = {
  id: string;
  name?: string;
};

const MAX_ASSIGNEE_RESULTS_WHEN_BROWSING = 50;
const MAX_ASSIGNEE_RESULTS_WHEN_SEARCHING = 20;

export const getVisibleAssigneeOptions = (params: {
  contacts: AssigneeOption[];
  query: string;
  selectedAssigneeId?: string;
}): AssigneeOption[] => {
  const { contacts, selectedAssigneeId } = params;
  const normalizedQuery = params.query.toLowerCase().trim();

  if (!normalizedQuery) {
    const limitedContacts = contacts.slice(
      0,
      MAX_ASSIGNEE_RESULTS_WHEN_BROWSING
    );

    if (!selectedAssigneeId) {
      return limitedContacts;
    }

    if (limitedContacts.some((contact) => contact.id === selectedAssigneeId)) {
      return limitedContacts;
    }

    const selectedContact = contacts.find(
      (contact) => contact.id === selectedAssigneeId
    );
    if (!selectedContact) {
      return limitedContacts;
    }

    return [
      selectedContact,
      ...limitedContacts.slice(0, MAX_ASSIGNEE_RESULTS_WHEN_BROWSING - 1),
    ];
  }

  return contacts
    .filter(
      (contact) =>
        contact.name?.toLowerCase().includes(normalizedQuery) ||
        contact.id.toLowerCase().includes(normalizedQuery)
    )
    .slice(0, MAX_ASSIGNEE_RESULTS_WHEN_SEARCHING);
};
