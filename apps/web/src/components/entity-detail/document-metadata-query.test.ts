import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { isLocallySortable } from '@queries/soup/graphql/reconciliation';
import { describe, expect, it } from 'vitest';
import { documentMetadataArgs } from './document-metadata-query';

describe('documentMetadataArgs', () => {
  it('asks for a sort the local cache can answer', () => {
    const input = makeGraphqlSoupInput({
      ...documentMetadataArgs('doc-1'),
    }).initial;
    expect(input?.sortMethod).toBeDefined();
    expect(isLocallySortable(input?.sortMethod)).toBe(true);
  });
});
