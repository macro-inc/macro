/**
 * @vitest-environment jsdom
 */

import { useTagSets } from '@property/tags/tag-sets-context';
import { render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailLinks } from './email-links-context';
import {
  ListEntityMetadataQueryProvider,
  ListEntityNoopMetadataProvider,
} from './list-entity-metadata-provider';

const mocks = vi.hoisted(() => ({
  useEmailLinksQuery: vi.fn(),
  useTagsQuery: vi.fn(),
}));

vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: mocks.useEmailLinksQuery,
}));

vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: mocks.useTagsQuery,
}));

function MetadataConsumer(props: { label: string }) {
  const emailLinks = useEmailLinks();
  const tagSets = useTagSets();
  return (
    <span>
      {props.label}:{emailLinks().length}:{tagSets().length}
    </span>
  );
}

beforeEach(() => {
  mocks.useEmailLinksQuery.mockReset();
  mocks.useTagsQuery.mockReset();
  mocks.useEmailLinksQuery.mockReturnValue({
    data: { links: [{ id: 'inbox-1' }] },
  });
  mocks.useTagsQuery.mockReturnValue({
    data: [{ scope: 'user', options: [] }],
  });
});

describe('ListEntityMetadataProvider', () => {
  it('shares one query observer of each kind across a collection', () => {
    render(() => (
      <ListEntityMetadataQueryProvider>
        <MetadataConsumer label="first" />
        <MetadataConsumer label="second" />
      </ListEntityMetadataQueryProvider>
    ));

    expect(screen.getByText('first:1:1')).toBeTruthy();
    expect(screen.getByText('second:1:1')).toBeTruthy();
    expect(mocks.useEmailLinksQuery).toHaveBeenCalledOnce();
    expect(mocks.useTagsQuery).toHaveBeenCalledOnce();
  });

  it('provides explicit empty metadata without creating queries', () => {
    render(() => (
      <ListEntityNoopMetadataProvider>
        <MetadataConsumer label="noop" />
      </ListEntityNoopMetadataProvider>
    ));

    expect(screen.getByText('noop:0:0')).toBeTruthy();
    expect(mocks.useEmailLinksQuery).not.toHaveBeenCalled();
    expect(mocks.useTagsQuery).not.toHaveBeenCalled();
  });
});
