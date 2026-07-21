/**
 * @vitest-environment jsdom
 */

import { useTagSets } from '@property/tags/tag-sets-context';
import { render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ListEntityMetadataQueryProvider,
  ListEntityNoopMetadataProvider,
} from './list-entity-metadata-provider';

const mocks = vi.hoisted(() => ({
  useTagsQuery: vi.fn(),
}));

vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: mocks.useTagsQuery,
}));

function MetadataConsumer(props: { label: string }) {
  const tagSets = useTagSets();
  return (
    <span>
      {props.label}:{tagSets().length}
    </span>
  );
}

beforeEach(() => {
  mocks.useTagsQuery.mockReset();
  mocks.useTagsQuery.mockReturnValue({
    data: [{ scope: 'user', options: [] }],
  });
});

describe('ListEntityMetadataProvider', () => {
  it('shares one tag query across a collection', () => {
    render(() => (
      <ListEntityMetadataQueryProvider>
        <MetadataConsumer label="first" />
        <MetadataConsumer label="second" />
      </ListEntityMetadataQueryProvider>
    ));

    expect(screen.getByText('first:1')).toBeTruthy();
    expect(screen.getByText('second:1')).toBeTruthy();
    expect(mocks.useTagsQuery).toHaveBeenCalledOnce();
  });

  it('provides explicit empty metadata without creating queries', () => {
    render(() => (
      <ListEntityNoopMetadataProvider>
        <MetadataConsumer label="noop" />
      </ListEntityNoopMetadataProvider>
    ));

    expect(screen.getByText('noop:0')).toBeTruthy();
    expect(mocks.useTagsQuery).not.toHaveBeenCalled();
  });
});
