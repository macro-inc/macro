/**
 * @vitest-environment jsdom
 */

import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  SidebarTagsSection,
  type SidebarTagsSectionProps,
  selectSidebarTag,
} from './SidebarTagsSection';
import { TagSetsProvider } from './tag-sets-context';

const mocks = vi.hoisted(() => ({
  tagEditorDialog: vi.fn(),
}));

vi.mock('./TagEditorDialog', () => ({
  TagEditorDialog: (props: { open: boolean }) => {
    mocks.tagEditorDialog(props);
    return <div data-testid="tag-editor" data-open={String(props.open)} />;
  },
}));

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ isSuccess: false, data: undefined }),
}));

const TAG_SETS = [
  {
    scope: 'user',
    definition: { id: 'personal-definition' },
    options: [
      {
        id: 'urgent',
        propertyDefinitionId: 'personal-definition',
        displayOrder: 0,
        value: { type: 'string', value: 'Urgent' },
      },
      {
        id: 'later',
        propertyDefinitionId: 'personal-definition',
        displayOrder: 1,
        value: { type: 'string', value: 'Later' },
      },
    ],
  },
] as TagSetResponse[];

function renderSection(
  overrides: Partial<SidebarTagsSectionProps> = {},
  tagSets: TagSetResponse[] = TAG_SETS
) {
  const [activeIds, setActiveIds] = createSignal<string[]>([]);
  const onActiveIdsChange = vi.fn((ids: string[]) => setActiveIds(ids));

  render(() => (
    <TagSetsProvider tagSets={() => tagSets}>
      <SidebarTagsSection
        activeIds={activeIds()}
        onActiveIdsChange={onActiveIdsChange}
        open
        onOpenChange={() => {}}
        {...overrides}
      />
    </TagSetsProvider>
  ));

  return { onActiveIdsChange };
}

describe('selectSidebarTag', () => {
  it('shows a chosen tag alone and drops a chosen active tag', () => {
    expect(selectSidebarTag([], 'urgent')).toEqual(['urgent']);
    expect(selectSidebarTag(['later'], 'urgent')).toEqual(['urgent']);
    expect(selectSidebarTag(['urgent'], 'urgent')).toEqual([]);
    expect(selectSidebarTag(['urgent', 'later'], 'urgent')).toEqual(['later']);
  });
});

describe('SidebarTagsSection', () => {
  it('lists every tag and marks the active ones', () => {
    renderSection({ activeIds: ['later'] });

    const rows = screen.getAllByRole('button', { name: /Urgent|Later/ });
    expect(rows.map((row) => row.textContent)).toEqual(['Urgent', 'Later']);
    expect(
      screen.getByRole('button', { name: 'Later' }).getAttribute('aria-current')
    ).toBe('page');
    expect(
      screen
        .getByRole('button', { name: 'Urgent' })
        .getAttribute('aria-current')
    ).toBeNull();
  });

  it('hands the host the selection a click asks for', async () => {
    const onNavigate = vi.fn();
    const { onActiveIdsChange } = renderSection({ onNavigate });

    await fireEvent.click(screen.getByRole('button', { name: 'Urgent' }));
    expect(onActiveIdsChange).toHaveBeenLastCalledWith(['urgent']);
    expect(onNavigate).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole('button', { name: 'Urgent' }));
    expect(onActiveIdsChange).toHaveBeenLastCalledWith([]);
  });

  it('expands virtual parents without filtering and selects an exact nested tag', async () => {
    const sets = [
      {
        ...TAG_SETS[0],
        options: [
          {
            ...TAG_SETS[0].options[0],
            value: { type: 'string' as const, value: 'Work/Urgent' },
          },
        ],
      },
    ];
    const { onActiveIdsChange } = renderSection({}, sets);
    expect(screen.queryByRole('button', { name: 'Urgent' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    expect(onActiveIdsChange).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Urgent' }));
    expect(onActiveIdsChange).toHaveBeenLastCalledWith(['urgent']);
    await fireEvent.click(
      screen.getByRole('button', { name: 'Collapse Work' })
    );
    expect(screen.queryByRole('button', { name: 'Urgent' })).toBeNull();
  });

  it('reveals restored selections and separates parent selection from disclosure', async () => {
    const sets = [
      {
        ...TAG_SETS[0],
        options: [
          {
            ...TAG_SETS[0].options[0],
            value: { type: 'string' as const, value: 'Work/Urgent' },
          },
          {
            ...TAG_SETS[0].options[1],
            value: { type: 'string' as const, value: 'Work' },
          },
        ],
      },
    ];
    const onSelect = vi.fn();
    renderSection({ activeIds: ['urgent'], onActiveIdsChange: onSelect }, sets);
    expect(
      screen
        .getByRole('button', { name: 'Urgent' })
        .getAttribute('aria-current')
    ).toBe('page');
    await fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    expect(onSelect).toHaveBeenLastCalledWith(['later']);
    await fireEvent.click(
      screen.getByRole('button', { name: 'Collapse Work' })
    );
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('updates the hierarchy when the provider catalog changes', async () => {
    const [sets, setSets] = createSignal<TagSetResponse[]>([]);
    render(() => (
      <TagSetsProvider tagSets={sets}>
        <SidebarTagsSection
          activeIds={[]}
          onActiveIdsChange={() => {}}
          open
          onOpenChange={() => {}}
        />
      </TagSetsProvider>
    ));
    expect(screen.getByText('No tags yet')).toBeTruthy();
    const catalog = (name: string) => [
      {
        ...TAG_SETS[0],
        options: [
          {
            ...TAG_SETS[0].options[0],
            value: { type: 'string' as const, value: name },
          },
        ],
      },
    ];
    setSets(catalog('Work/Urgent'));
    await fireEvent.click(screen.getByRole('button', { name: 'Expand Work' }));
    expect(screen.getByRole('button', { name: 'Urgent' })).toBeTruthy();
    setSets(catalog('Home/Urgent'));
    expect(screen.queryByRole('button', { name: 'Work' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Expand Home' }));
    expect(screen.getByRole('button', { name: 'Urgent' })).toBeTruthy();
    setSets([]);
    expect(screen.getByText('No tags yet')).toBeTruthy();
  });

  it('opens the tag editor from the New tag action', async () => {
    renderSection();

    const editorOpen = () =>
      screen.getByTestId('tag-editor').getAttribute('data-open');
    expect(editorOpen()).toBe('false');

    await fireEvent.click(screen.getByRole('button', { name: 'New tag' }));

    expect(editorOpen()).toBe('true');
    expect(mocks.tagEditorDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: { type: 'create', initialScope: 'user' },
        teamAvailable: false,
      })
    );
  });

  it('explains an empty list instead of rendering no rows', () => {
    renderSection({}, []);

    expect(screen.getByText('No tags yet')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Tags' })).toBeNull();
  });
});
