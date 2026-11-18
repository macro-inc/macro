import { useAssigneePicker } from '@app/features/soup/assignee-picker';
import { useSelectedFirst } from '@core/util/useSelectedFirst';
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
vi.mock('@core/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/user')>()),
  getDisplayName: (id: string | undefined) =>
    id === 'macro|outside@example.com' ? 'Outside Person' : '',
}));
vi.mock('@queries/team/members', () => ({
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
  it('lists you, Unassigned and team members before agents', () => {
    createRoot((dispose) => {
      const picker = useAssigneePicker(
        () => [],
        () => true
      );
      expect(picker.options().map((option) => option.id)).toEqual([
        'macro|alice@example.com',
        'NO_ASSIGNEE',
        'macro|teammate@example.com',
        'bot|00000000-0000-0000-0000-000000000123',
      ]);
      dispose();
    });
  });

  it('keeps team rows stable during selection and reorders on reopening', () => {
    createRoot((dispose) => {
      const [ids, setIds] = createSignal(['macro|alice@example.com']);
      const picker = useAssigneePicker(ids, () => true);
      const ordered = useSelectedFirst({
        items: picker.options,
        selectedIds: picker.selectedIdsAtViewEntry,
        searchQuery: () => '',
        getId: (option) => option.id,
        sortDeps: [picker.selectedIdsAtViewEntry],
      });
      picker.onOpenChange(true);
      const initial = ordered().map((option) => option.id);
      setIds(['macro|alice@example.com', 'macro|teammate@example.com']);
      expect(ordered().map((option) => option.id)).toEqual(initial);
      setIds(['macro|teammate@example.com']);
      expect(ordered().map((option) => option.id)).toEqual(initial);
      picker.onOpenChange(false);
      picker.onOpenChange(true);
      expect(ordered().map((option) => option.id)).toEqual([
        'macro|teammate@example.com',
        'macro|alice@example.com',
        'NO_ASSIGNEE',
        'bot|00000000-0000-0000-0000-000000000123',
      ]);
      dispose();
    });
  });

  it('names a selected outsider instead of showing its id', () => {
    createRoot((dispose) => {
      const picker = useAssigneePicker(
        () => ['macro|outside@example.com'],
        () => true
      );
      expect(
        picker
          .options()
          .find((option) => option.id === 'macro|outside@example.com')?.label
      ).toBe('Outside Person');
      dispose();
    });
  });

  it('allows re-adding a selected outsider only during the same opening', () => {
    createRoot((dispose) => {
      const [ids, setIds] = createSignal(['macro|outside@example.com']);
      const picker = useAssigneePicker(ids, () => true);
      picker.onOpenChange(true);
      expect(picker.selectedIdsAtViewEntry()).toEqual([
        'macro|outside@example.com',
      ]);
      expect(picker.options().map((option) => option.id)).toEqual([
        'macro|alice@example.com',
        'NO_ASSIGNEE',
        'macro|teammate@example.com',
        'macro|outside@example.com',
        'bot|00000000-0000-0000-0000-000000000123',
      ]);
      setIds([]);
      expect(
        picker
          .options()
          .some((option) => option.id === 'macro|outside@example.com')
      ).toBe(true);
      picker.onOpenChange(false);
      picker.onOpenChange(true);
      expect(
        picker
          .options()
          .some((option) => option.id === 'macro|outside@example.com')
      ).toBe(false);
      dispose();
    });
  });
});
