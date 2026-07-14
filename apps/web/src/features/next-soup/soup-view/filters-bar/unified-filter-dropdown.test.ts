import { describe, expect, it } from 'vitest';
import {
  type FilterCategory,
  filterInboxGithubPrOption,
} from './filter-categories';

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
