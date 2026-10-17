/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tags: { data: [] as unknown[] },
  openWithSplit: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => mocks.tags,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('@property/tags/tagNavigation', () => ({
  navigateToTag: mocks.navigate,
}));

import { TagsCard } from './tags-card';

afterEach(() => {
  cleanup();
  mocks.navigate.mockReset();
  mocks.tags.data = [];
});

const ontology = [
  {
    label: 'Type',
    description: 'What kind of work it is',
    children: [
      {
        label: 'bug',
        color: 'red',
        description: 'Defects',
        tagId: 'opt-bug',
      },
      { label: 'feature', color: 'indigo' },
    ],
  },
  { label: 'docs', color: 'blue' },
];

/** The text of each row directly in a list, without its nested rows. */
function rowsOf(list: HTMLElement) {
  return [...list.children].map(
    (item) => item.querySelector('[data-card-row]')?.textContent
  );
}

describe('TagsCard', () => {
  it('nests each tag under the one it narrows, with what it is for', () => {
    const { getByRole } = render(() => (
      <TagsCard title="Company tags" tags={ontology} />
    ));
    const card = getByRole('region', { name: 'Company tags' });
    expect(card.textContent).toContain('4 tags');
    const [top] = within(card).getAllByRole('list');
    expect(rowsOf(top)).toEqual(['TypeWhat kind of work it is', 'docs']);
    const nested = within(top.children[0] as HTMLElement).getByRole('list');
    expect(rowsOf(nested)).toEqual(['bugDefects', 'feature']);
  });

  it('shows a tag the viewer has by its current name, and opens what is tagged with it', () => {
    mocks.tags.data = [
      {
        scope: 'user',
        options: [
          {
            id: 'opt-bug',
            propertyDefinitionId: 'def-1',
            value: { type: 'string', value: 'Bug' },
            color: '#E54D2E',
            displayOrder: 0,
          },
        ],
      },
    ];
    const { getByRole, queryByRole } = render(() => (
      <TagsCard tags={ontology} />
    ));
    fireEvent.click(getByRole('button', { name: /Bug/ }));
    expect(mocks.navigate).toHaveBeenCalledWith(
      mocks.openWithSplit,
      { optionId: 'opt-bug', propertyDefinitionId: 'def-1' },
      { handle: undefined }
    );
    expect(queryByRole('button', { name: /feature/ })).toBeNull();
  });

  it('says when there are no tags', () => {
    const { getByText } = render(() => <TagsCard tags={[]} />);
    expect(getByText('No tags.')).toBeTruthy();
    expect(getByText('0 tags')).toBeTruthy();
  });
});
