import { useAssigneePicker } from '@app/features/soup/assignee-picker';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  type FilterCategory,
  filterInboxGithubPrOption,
} from './filter-categories';

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|alice@example.com',
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@property/queries/team-members', () => ({
  useTeamMembers: () => ({
    users: () => [
      {
        id: 'macro|alice@example.com',
        email: 'alice@example.com',
        name: 'Alice',
      },
      {
        id: 'macro|teammate@example.com',
        email: 'teammate@example.com',
        name: 'Teammate',
      },
    ],
    isLoading: () => false,
    isError: () => false,
  }),
}));
vi.mock('@property/queries/agent-assignees', () => ({
  useAgentAssignees: () => () => [
    {
      id: 'bot|00000000-0000-0000-0000-000000000123',
      email: '',
      name: 'Agent',
    },
  ],
}));
const categories: FilterCategory[] = [
  {
    id: 'type',
    label: 'Type',
    options: [
      { id: 'document', label: 'Docs' },
      { id: 'github-pr', label: 'GitHub PRs' },
    ],
    multiple: true,
  },
  {
    id: 'status',
    label: 'Status',
    options: [{ id: 'unread', label: 'Unread' }],
  },
];

describe('filterInboxGithubPrOption', () => {
  it('keeps the GitHub PR option for linked users', () => {
    expect(filterInboxGithubPrOption(categories, true)[0]?.options).toEqual([
      { id: 'document', label: 'Docs' },
      { id: 'github-pr', label: 'GitHub PRs' },
    ]);
  });

  it('removes the GitHub PR option for users without a linked GitHub account', () => {
    expect(filterInboxGithubPrOption(categories, false)[0]?.options).toEqual([
      { id: 'document', label: 'Docs' },
    ]);
  });

  it('leaves other filter categories unchanged', () => {
    expect(filterInboxGithubPrOption(categories, false)[1]).toBe(categories[1]);
  });
});

describe('Assignee filter ordering', () => {
  it('keeps team rows stable during selection and reorders on reopening', () => {
    createRoot((dispose) => {
      const [ids, setIds] = createSignal(['macro|alice@example.com']);
      const picker = useAssigneePicker(ids, () => true);
      picker.onOpenChange(true);
      const initial = picker.options().map((option) => option.id);
      setIds(['macro|alice@example.com', 'macro|teammate@example.com']);
      expect(picker.options().map((option) => option.id)).toEqual(initial);
      setIds(['macro|teammate@example.com']);
      expect(picker.options().map((option) => option.id)).toEqual(initial);
      picker.onOpenChange(false);
      picker.onOpenChange(true);
      expect(picker.options()[0].id).toBe('macro|teammate@example.com');
      expect(picker.options()[1].id).toBe(
        'bot|00000000-0000-0000-0000-000000000123'
      );
      dispose();
    });
  });

  it('retains selected outsiders without offering unrelated contacts', () => {
    createRoot((dispose) => {
      const [ids, setIds] = createSignal(['macro|outside@example.com']);
      const picker = useAssigneePicker(ids, () => true);
      picker.onOpenChange(true);
      expect(picker.options()[0].id).toBe('macro|outside@example.com');
      setIds([]);
      expect(
        picker
          .options()
          .some((option) => option.id === 'macro|outside@example.com')
      ).toBe(false);
      dispose();
    });
  });
});
