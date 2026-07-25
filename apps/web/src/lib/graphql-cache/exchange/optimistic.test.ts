import { GroupSoupMembershipDocument } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it } from 'vitest';
import { prependUnique, remove, select, update } from './optimistic';

const input = {
  initial: {
    groupBy: {
      field: 'PROPERTY' as const,
      propertyDefinitionId: 'status-def',
    },
    limit: 20,
  },
};

function itemsIn(groupKey: string) {
  return select(GroupSoupMembershipDocument, { input })
    .field('user')
    .field('groupSoup')
    .field('bins')
    .item('key', groupKey)
    .field('items');
}

describe('typed optimistic graph updates', () => {
  it('serializes a generated query entrypoint, variables, path, and diff', () => {
    const removal = update(
      itemsIn('in-progress'),
      remove('GraphqlSoupItem:task-1')
    );
    const prepend = update(
      itemsIn('completed'),
      prependUnique('GraphqlSoupItem:task-1')
    );

    expect(removal.operationName).toBe('GroupSoupMembership');
    expect(JSON.parse(removal.variablesJson)).toEqual({ input });
    expect(removal.path).toEqual([
      { field: 'user' },
      { field: 'groupSoup' },
      { field: 'bins' },
      { listItem: { whereField: 'key', equals: 'in-progress' } },
      { field: 'items' },
    ]);
    expect(removal.operation).toEqual({
      kind: 'remove',
      entityKey: 'GraphqlSoupItem:task-1',
    });
    expect(prepend.operation.kind).toBe('prependUnique');
  });

  it('uses generated operation result and variable types', () => {
    const typeAssertions = () => {
      // @ts-expect-error GroupSoupMembership requires an input variable.
      select(GroupSoupMembershipDocument, {});

      const root = select(GroupSoupMembershipDocument, { input });
      // @ts-expect-error `missing` is not selected by this generated query.
      root.field('missing');

      const bins = root.field('user').field('groupSoup').field('bins');
      // @ts-expect-error A bin has no `missing` scalar selector.
      bins.item('missing', 'value');
      // @ts-expect-error The generated bin key is a string.
      bins.item('key', 123);
      // @ts-expect-error Updates must target a generated list selection.
      update(root.field('user'), remove('GraphqlUser:user-1'));
    };

    expect(typeAssertions).toBeTypeOf('function');
  });
});
