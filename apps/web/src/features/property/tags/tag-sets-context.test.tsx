/**
 * @vitest-environment jsdom
 */

import type { CollapsibleRegistration } from '@components/app/split-layout/utils/createPriorityCollapser';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, type JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityRowTags } from './EntityRowTags';
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
    const properties = [
      {
        id: 'property-assignment',
        definition: { id: 'tag-definition' },
        value: {
          type: 'SelectOption',
          value: ['first-tag', 'second-tag', 'third-tag', 'fourth-tag'],
        },
      } as SoupProperty,
    ];
    const view = render(() => (
      <QueryClientProvider client={new QueryClient()}>
        <TagSetsProvider tagSets={tagSets}>
          <EntityRowTags
            entityId="document-resize"
            entityType={EntityType.DOCUMENT}
            properties={properties}
            collapse={collapse}
          />
        </TagSetsProvider>
      </QueryClientProvider>
    ));

    expect(view.getByRole('button', { name: 'Third' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Fourth' })).toBeNull();
    expect(view.getByRole('button', { name: '+1 tag' })).toBeTruthy();
    const first = view.getByRole('button', { name: 'First' });
    await fireEvent.click(first);
    expect(registrations.size).toBe(0);
    expect(view.getByRole('button', { name: 'First' })).toBe(first);
    expect(mocks.useSoupDocTags).toHaveBeenCalledOnce();

    await fireEvent.click(first);
    for (const registration of registrations.values()) {
      registration.setCollapsed(true);
    }
    const overflow = view.getByRole('button', { name: '+4 tags' });
    expect(first.isConnected).toBe(false);
    await fireEvent.click(overflow);
    expect(registrations.size).toBe(0);
    expect(view.getByRole('button', { name: '+4 tags' })).toBe(overflow);

    await fireEvent.click(overflow);
    for (const registration of registrations.values()) {
      registration.setCollapsed(false);
    }
    expect(view.getByRole('button', { name: '+1 tag' })).toBe(overflow);
    expect(view.getByRole('button', { name: 'First' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Second' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Third' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Fourth' })).toBeNull();
  });
});
