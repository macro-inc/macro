import type { GroupedSoupInput } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it } from 'vitest';
import {
  groupedSoupInputKey,
  registerGroupedSoupContinuation,
} from './graphql-operation-registry';
import { groupPagesByLogicalView } from './graphql-optimistic';

describe('grouped GraphQL operation registry', () => {
  it('groups JSON-equivalent inputs when optional fields are undefined', () => {
    const withUndefined: GroupedSoupInput = {
      initial: {
        groupBy: {
          field: 'PROPERTY',
          propertyDefinitionId: 'status-def',
          entityType: undefined,
        },
        limit: undefined,
      },
    };
    const roundTripped = JSON.parse(
      JSON.stringify(withUndefined)
    ) as GroupedSoupInput;
    const continuation: GroupedSoupInput = {
      continuation: {
        groupBy: {
          field: 'PROPERTY',
          propertyDefinitionId: 'status-def',
        },
        groupKey: 'in-progress',
        cursor: 'undefined-regression-cursor',
      },
    };

    expect(groupedSoupInputKey(withUndefined)).toBe(
      groupedSoupInputKey(roundTripped)
    );

    registerGroupedSoupContinuation(withUndefined, continuation);
    const views = groupPagesByLogicalView([
      { input: roundTripped, bins: [] },
      { input: continuation, bins: [] },
    ]);

    expect([...views.values()].map((pages) => pages.length)).toEqual([2]);
  });
});
