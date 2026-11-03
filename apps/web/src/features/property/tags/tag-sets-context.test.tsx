/**
 * @vitest-environment jsdom
 */

import type { CollapsibleRegistration } from '@app/components/priority-collapse/createPriorityCollapser';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createRoot, createSignal, type JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityRowTags } from './EntityRowTags';
import { createTagPickerSession, type DocTags } from './tag-picker-session';
import { TagSetsProvider } from './tag-sets-context';

const mocks = vi.hoisted(() => ({
  useDocTags: vi.fn(),
  useSoupDocTags: vi.fn(),
}));

vi.mock('./TagPicker', () => ({
  TagPicker: (props: {
    children: JSX.Element;
    createDocTags?: () => unknown;
    onActiveChange?: (active: boolean) => void;
  }) => {
    const [open, setOpen] = createSignal(false);
    return (
      <button
        type="button"
        onClick={() => {
          const nextOpen = !open();
          setOpen(nextOpen);
          if (nextOpen) props.createDocTags?.();
          props.onActiveChange?.(nextOpen);
        }}
      >
        {props.children}
      </button>
    );
  },
}));

vi.mock('./TagDot', () => ({
  TagDot: () => <span data-testid="tag-dot" />,
}));

vi.mock('./useDocTags', () => ({
  useDocTags: mocks.useDocTags,
  useSoupDocTags: mocks.useSoupDocTags,
}));

vi.mock('@components/app/split-layout/layout', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSplitLayout: () => ({}),
}));
vi.mock('@components/app/split-layout/layoutUtils', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSplitPanel: () => undefined,
}));
vi.mock(
  '@property/editors/selectors/PropertyOptionSelector',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useDropdownSearch: () => ({
      setSelectedIndex: () => {},
      selectedIndex: () => 0,
      keyboardMode: () => false,
    }),
  })
);
vi.mock('@queries/properties/options', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAddPropertyOptionMutation: () => ({ isPending: false }),
}));
vi.mock('@queries/properties/tags', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnsureTagSetMutation: () => ({ isPending: false }),
}));
vi.mock('@queries/team/teams', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCurrentTeamQuery: () => ({}),
}));

beforeEach(() => {
  mocks.useDocTags.mockReset();
  mocks.useSoupDocTags.mockReset();
});

describe('TagSetsContext', () => {
  it('uses the real row resolver and initializes editing only on interaction', async () => {
    const tagSets = (): TagSetResponse[] => [
      {
        definition: { id: 'tag-definition' },
        scope: 'user',
        options: [
          {
            id: 'urgent-tag',
            propertyDefinitionId: 'tag-definition',
            displayOrder: 0,
            value: { type: 'string', value: 'Urgent' },
          },
        ],
      } as TagSetResponse,
    ];
    const properties = [
      {
        id: 'property-assignment',
        definition: { id: 'tag-definition' },
        value: { type: 'SelectOption', value: ['urgent-tag'] },
      } as SoupProperty,
    ];

    // Rows read pending option mutations to overlay an uncommitted selection,
    // so they need a client even though they start no mutation of their own.
    render(() => (
      <QueryClientProvider client={new QueryClient()}>
        <TagSetsProvider tagSets={tagSets}>
          <EntityRowTags
            entityId="document-1"
            entityType={EntityType.DOCUMENT}
            properties={properties}
            maxVisible={0}
          />
        </TagSetsProvider>
      </QueryClientProvider>
    ));

    expect(screen.getByText('Urgent')).toBeTruthy();
    expect(mocks.useSoupDocTags).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button'));

    expect(mocks.useSoupDocTags).toHaveBeenCalledOnce();
    expect(mocks.useSoupDocTags).toHaveBeenCalledWith(
      'document-1',
      EntityType.DOCUMENT,
      expect.any(Function)
    );
  });

  it('caps visible tags while preserving collapse and active picker state', async () => {
    const registrations = new Map<string, CollapsibleRegistration>();
    const collapse = {
      register(registration: CollapsibleRegistration) {
        registrations.set(registration.id, registration);
        return () => {
          registrations.delete(registration.id);
        };
      },
    };
    const tagSets = (): TagSetResponse[] => [
      {
        definition: { id: 'tag-definition' },
        scope: 'user',
        options: [
          {
            id: 'first-tag',
            propertyDefinitionId: 'tag-definition',
            displayOrder: 0,
            value: { type: 'string', value: 'First' },
          },
          {
            id: 'second-tag',
            propertyDefinitionId: 'tag-definition',
            displayOrder: 1,
            value: { type: 'string', value: 'Second' },
          },
          {
            id: 'third-tag',
            propertyDefinitionId: 'tag-definition',
            displayOrder: 2,
            value: { type: 'string', value: 'Third' },
          },
          {
            id: 'fourth-tag',
            propertyDefinitionId: 'tag-definition',
            displayOrder: 3,
            value: { type: 'string', value: 'Fourth' },
          },
        ],
      } as TagSetResponse,
    ];
    const [tagIds, setTagIds] = createSignal([
      'first-tag',
      'second-tag',
      'third-tag',
    ]);
    const properties = () => [
      {
        id: 'property-assignment',
        definition: { id: 'tag-definition' },
        value: {
          type: 'SelectOption',
          value: tagIds(),
        },
      } as SoupProperty,
    ];
    const view = render(() => (
      <QueryClientProvider client={new QueryClient()}>
        <TagSetsProvider tagSets={tagSets}>
          <EntityRowTags
            entityId="document-resize"
            entityType={EntityType.DOCUMENT}
            properties={properties()}
            collapse={collapse}
          />
        </TagSetsProvider>
      </QueryClientProvider>
    ));

    expect(view.getByRole('button', { name: 'Third' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Fourth' })).toBeNull();
    expect(view.queryByRole('button', { name: '+1 tag' })).toBeNull();
    const first = view.getByRole('button', { name: 'First' });
    await fireEvent.click(first);
    expect(registrations.size).toBe(0);
    expect(view.getByRole('button', { name: 'First' })).toBe(first);
    expect(mocks.useSoupDocTags).toHaveBeenCalledOnce();

    setTagIds(['first-tag', 'second-tag', 'third-tag', 'fourth-tag']);
    expect(view.getByRole('button', { name: 'First' })).toBe(first);
    expect(registrations.size).toBe(0);

    await fireEvent.click(first);
    for (const registration of registrations.values()) {
      registration.setCollapsed(true);
    }
    const overflow = view.getByRole('button', { name: '4 tags' });
    expect(first.isConnected).toBe(false);
    await fireEvent.click(overflow);
    expect(registrations.size).toBe(0);
    expect(view.getByRole('button', { name: '4 tags' })).toBe(overflow);

    await fireEvent.click(overflow);
    for (const registration of registrations.values()) {
      registration.setCollapsed(false);
    }
    expect(view.getByRole('button', { name: '+1 tag' })).toBe(overflow);
    expect(view.getByRole('button', { name: 'First' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Second' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Third' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Fourth' })).toBeNull();

    for (const registration of registrations.values()) {
      registration.setCollapsed(true);
    }
    setTagIds(['first-tag']);
    expect(registrations.size).toBe(0);
    expect(view.getByRole('button', { name: 'First' })).toBeTruthy();

    setTagIds(['first-tag', 'second-tag', 'third-tag', 'fourth-tag']);
    expect(registrations.size).toBe(3);
    expect(view.getByRole('button', { name: '4 tags' })).toBeTruthy();

    for (const registration of registrations.values()) {
      registration.setCollapsed(false);
    }
    const removedChip = view.getByRole('button', { name: 'First' });
    await fireEvent.click(removedChip);
    setTagIds(['second-tag', 'third-tag']);
    expect(removedChip.isConnected).toBe(false);
    expect(registrations.size).toBe(2);

    setTagIds(['first-tag', 'second-tag', 'third-tag', 'fourth-tag']);
    const removedOverflow = view.getByRole('button', { name: '+1 tag' });
    await fireEvent.click(removedOverflow);
    setTagIds(['first-tag', 'second-tag', 'third-tag']);
    expect(removedOverflow.isConnected).toBe(false);
    expect(registrations.size).toBe(3);

    setTagIds(['first-tag', 'second-tag', 'third-tag', 'fourth-tag']);
    expect(registrations.size).toBe(3);
    for (const registration of registrations.values()) {
      registration.setCollapsed(true);
    }
    expect(view.getByRole('button', { name: '4 tags' })).toBeTruthy();
  });
});

describe('TagPickerSession', () => {
  it('reconciles live selections and deletion rollbacks without losing staged changes', async () => {
    const option = (id: string) => ({
      id,
      propertyDefinitionId: 'tag-definition',
      displayOrder: 0,
      value: { type: 'string' as const, value: id },
    });
    const [applied, setApplied] = createSignal(['a', 'b']);
    const [options, setOptions] = createSignal(['a', 'b', 'c', 'd', 'e']);
    const setTagSelection = vi.fn(async (_ids: ReadonlySet<string>) => {});
    let dispose = () => {};
    const session = createRoot((cleanup) => {
      dispose = cleanup;
      return createTagPickerSession({
        docTags: {
          appliedTags: () =>
            applied().map((optionId) => ({
              optionId,
              propertyDefinitionId: 'tag-definition',
              scope: 'user' as const,
              label: optionId,
            })),
          tagSets: () => [
            {
              scope: 'user',
              definition: { id: 'tag-definition' },
              options: options().map(option),
            },
          ],
          setTagSelection,
        } as unknown as DocTags,
        onClose: () => {},
        onOpenEditEditor: () => {},
        confirmsWithDone: true,
      });
    });

    session.pick({ scope: 'user', option: option('a') });
    session.pick({ scope: 'user', option: option('c') });
    setApplied(['a', 'b', 'd']);
    expect(session.isSelected('a')).toBe(false);
    expect(session.isSelected('b')).toBe(true);
    expect(session.isSelected('c')).toBe(true);
    expect(session.isSelected('d')).toBe(true);

    setOptions(['a', 'b', 'd', 'e']);
    expect(session.isSelected('c')).toBe(false);
    session.pick({ scope: 'user', option: option('e') });
    setApplied(['a', 'b', 'd', 'e']);
    expect(session.isSelected('a')).toBe(false);
    expect(session.isSelected('e')).toBe(true);

    setOptions(['b', 'd', 'e']);
    setOptions(['a', 'b', 'c', 'd', 'e']);
    expect(session.isSelected('a')).toBe(false);
    expect(session.isSelected('c')).toBe(true);
    await session.persistSelection();
    expect([...setTagSelection.mock.calls[0][0]].sort()).toEqual([
      'b',
      'c',
      'd',
      'e',
    ]);
    dispose();
  });
});

describe('EntityRowTags live insertions', () => {
  it('keeps an active chip mounted within the visible cap until close', async () => {
    const registrations = new Map<string, CollapsibleRegistration>();
    const collapse = {
      register(registration: CollapsibleRegistration) {
        registrations.set(registration.id, registration);
        return () => registrations.delete(registration.id);
      },
    };
    const [tagIds, setTagIds] = createSignal(['b', 'c']);
    const tagSets = (): TagSetResponse[] => [
      {
        scope: 'user',
        definition: { id: 'tag-definition' },
        options: ['a', 'b', 'c'].map((id, displayOrder) => ({
          id,
          propertyDefinitionId: 'tag-definition',
          displayOrder,
          value: { type: 'string', value: id },
        })),
      } as TagSetResponse,
    ];
    const properties = () => [
      {
        id: 'assignment',
        definition: { id: 'tag-definition' },
        value: { type: 'SelectOption', value: tagIds() },
      } as SoupProperty,
    ];
    const view = render(() => (
      <QueryClientProvider client={new QueryClient()}>
        <TagSetsProvider tagSets={tagSets}>
          <EntityRowTags
            entityId="document-live-insert"
            entityType={EntityType.DOCUMENT}
            properties={properties()}
            maxVisible={2}
            collapse={collapse}
          />
        </TagSetsProvider>
      </QueryClientProvider>
    ));

    const active = view.getByRole('button', { name: 'c' });
    await fireEvent.click(active);
    setTagIds(['a', 'b', 'c']);
    expect(view.getByRole('button', { name: 'c' })).toBe(active);
    expect(view.queryByRole('button', { name: 'b' })).toBeNull();
    expect(view.getByRole('button', { name: '+1 tag' })).toBeTruthy();
    expect(registrations.size).toBe(0);

    await fireEvent.click(active);
    expect(registrations.size).toBe(2);
    expect(active.isConnected).toBe(false);
    expect(view.getByRole('button', { name: 'b' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'c' })).toBeNull();

    const removed = view.getByRole('button', { name: 'b' });
    await fireEvent.click(removed);
    setTagIds(['a', 'c']);
    expect(removed.isConnected).toBe(false);
    expect(registrations.size).toBe(2);
  });
});
