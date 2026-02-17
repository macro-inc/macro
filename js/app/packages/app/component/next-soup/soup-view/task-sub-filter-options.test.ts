import { describe, expect, it } from 'vitest';
import { getVisibleAssigneeOptions } from './task-sub-filter-options';

const createContacts = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `user-${index}`,
    name: `User ${index}`,
  }));

describe('getVisibleAssigneeOptions', () => {
  it('limits browse results to 50 contacts', () => {
    const contacts = createContacts(120);

    const result = getVisibleAssigneeOptions({
      contacts,
      query: '',
    });

    expect(result).toHaveLength(50);
    expect(result[0]?.id).toBe('user-0');
    expect(result[49]?.id).toBe('user-49');
  });

  it('limits search results to 20 contacts', () => {
    const contacts = createContacts(120);

    const result = getVisibleAssigneeOptions({
      contacts,
      query: 'user',
    });

    expect(result).toHaveLength(20);
    expect(result[0]?.id).toBe('user-0');
    expect(result[19]?.id).toBe('user-19');
  });

  it('keeps the selected assignee visible in browse mode', () => {
    const contacts = createContacts(120);

    const result = getVisibleAssigneeOptions({
      contacts,
      query: '',
      selectedAssigneeId: 'user-90',
    });

    expect(result).toHaveLength(50);
    expect(result[0]?.id).toBe('user-90');
    expect(result.some((contact) => contact.id === 'user-90')).toBe(true);
  });

  it('does not force selected assignee into search results when it does not match', () => {
    const contacts = createContacts(120);

    const result = getVisibleAssigneeOptions({
      contacts,
      query: 'user-1',
      selectedAssigneeId: 'user-90',
    });

    expect(result.some((contact) => contact.id === 'user-90')).toBe(false);
  });
});
