/**
 * @vitest-environment jsdom
 */

import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TagSetsProvider,
  TagSetsQueryProvider,
  useTagSets,
} from './tag-sets-context';

const mocks = vi.hoisted(() => ({
  useTagsQuery: vi.fn(),
}));

vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: mocks.useTagsQuery,
}));

function TagSetsConsumer() {
  const tagSets = useTagSets();
  return <span>{tagSets()[0]?.scope}</span>;
}

beforeEach(() => {
  mocks.useTagsQuery.mockReset();
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
