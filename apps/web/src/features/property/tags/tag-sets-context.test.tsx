/**
 * @vitest-environment jsdom
 */

import { EntityType } from '@service-properties/generated/schemas/entityType';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityRowTags } from './EntityRowTags';
import {
  TagSetsProvider,
  TagSetsQueryProvider,
  useTagSets,
} from './tag-sets-context';

const mocks = vi.hoisted(() => ({
  useTagsQuery: vi.fn(),
  useDocTags: vi.fn(),
  useSoupDocTags: vi.fn(),
}));

vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: mocks.useTagsQuery,
}));

vi.mock('./TagPicker', () => ({
  TagPicker: (props: {
    children: JSX.Element;
    createDocTags?: () => unknown;
  }) => (
    <button type="button" onClick={() => props.createDocTags?.()}>
      {props.children}
    </button>
  ),
}));

vi.mock('./TagDot', () => ({
  TagDot: () => <span data-testid="tag-dot" />,
}));

vi.mock('./useDocTags', () => ({
  useDocTags: mocks.useDocTags,
  useSoupDocTags: mocks.useSoupDocTags,
}));

function TagSetsConsumer() {
  const tagSets = useTagSets();
  return <span>{tagSets()[0]?.scope}</span>;
}

beforeEach(() => {
  mocks.useTagsQuery.mockReset();
  mocks.useDocTags.mockReset();
  mocks.useSoupDocTags.mockReset();
  mocks.useTagsQuery.mockReturnValue({
    data: [{ scope: 'user', options: [] }],
  });
});

describe('TagSetsContext', () => {
  it('uses the provided tag sets without another query', () => {
    const tagSets = (): TagSetResponse[] => [
      { scope: 'team', options: [] } as TagSetResponse,
    ];

    render(() => (
      <TagSetsProvider tagSets={tagSets}>
        <TagSetsConsumer />
      </TagSetsProvider>
    ));

    expect(screen.getByText('team')).toBeTruthy();
    expect(mocks.useTagsQuery).not.toHaveBeenCalled();
  });

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

    render(() => (
      <TagSetsProvider tagSets={tagSets}>
        <EntityRowTags
          entityId="document-1"
          entityType={EntityType.DOCUMENT}
          properties={properties}
        />
      </TagSetsProvider>
    ));

    expect(screen.getByText('Urgent')).toBeTruthy();
    expect(mocks.useTagsQuery).not.toHaveBeenCalled();
    expect(mocks.useSoupDocTags).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button'));

    expect(mocks.useSoupDocTags).toHaveBeenCalledOnce();
    expect(mocks.useSoupDocTags).toHaveBeenCalledWith(
      'document-1',
      EntityType.DOCUMENT,
      expect.any(Function)
    );
  });

  it('makes standalone query ownership explicit', () => {
    render(() => (
      <TagSetsQueryProvider>
        <TagSetsConsumer />
      </TagSetsQueryProvider>
    ));

    expect(screen.getByText('user')).toBeTruthy();
    expect(mocks.useTagsQuery).toHaveBeenCalledOnce();
  });

  it('fails fast outside a provider', () => {
    expect(() => render(() => <TagSetsConsumer />)).toThrow(
      'useTagSets can only be used under a TagSetsProvider'
    );
  });
});
