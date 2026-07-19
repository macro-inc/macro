/**
 * @vitest-environment jsdom
 */

import { useTagSets } from '@property/tags/tag-sets-context';
import type { Link } from '@service-email/generated/schemas';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailLinks } from './email-links-context';
import {
  ListEntityMetadataProvider,
  ListEntityMetadataQueryProvider,
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
      {props.label}:{emailLinks()[0]?.id}:{tagSets()[0]?.scope}
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

    expect(screen.getByText('first:inbox-1:user')).toBeTruthy();
    expect(screen.getByText('second:inbox-1:user')).toBeTruthy();
    expect(mocks.useEmailLinksQuery).toHaveBeenCalledOnce();
    expect(mocks.useTagsQuery).toHaveBeenCalledOnce();
  });

  it('accepts caller-owned metadata without creating queries', () => {
    const emailLinks = (): Link[] => [{ id: 'provided-inbox' } as Link];
    const tagSets = (): TagSetResponse[] => [
      { scope: 'team', options: [] } as TagSetResponse,
    ];

    render(() => (
      <ListEntityMetadataProvider emailLinks={emailLinks} tagSets={tagSets}>
        <MetadataConsumer label="provided" />
      </ListEntityMetadataProvider>
    ));

    expect(screen.getByText('provided:provided-inbox:team')).toBeTruthy();
    expect(mocks.useEmailLinksQuery).not.toHaveBeenCalled();
    expect(mocks.useTagsQuery).not.toHaveBeenCalled();
  });
});
