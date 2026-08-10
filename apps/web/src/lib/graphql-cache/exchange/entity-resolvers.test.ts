import { describe, expect, it } from 'vitest';
import {
  compileEntityResolvers,
  type EntityResolverConfig,
  entityFromArgument,
} from './entity-resolvers';

describe('entity resolvers', () => {
  it('retains literals while copying and freezing the argument path', () => {
    const sourcePath: ['input', 'threadId'] = ['input', 'threadId'];
    const descriptor = entityFromArgument('GraphqlSoupEmailThread', sourcePath);

    expect(descriptor).toEqual({
      kind: 'entity-from-argument',
      targetType: 'GraphqlSoupEmailThread',
      argumentPath: ['input', 'threadId'],
    });
    expect(descriptor.argumentPath).not.toBe(sourcePath);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.argumentPath)).toBe(true);
    sourcePath[1] = 'changed' as 'threadId';
    expect(descriptor.argumentPath).toEqual(['input', 'threadId']);
  });

  it('flattens deterministically and freezes copied wire descriptors', () => {
    const config = {
      GraphqlUser: {
        emailThread: entityFromArgument('GraphqlSoupEmailThread', [
          'input',
          'threadId',
        ]),
      },
      CompleteMutationRoot: {
        updateEmailThreadLabel: entityFromArgument('GraphqlSoupEmailThread', [
          'input',
          'labelId',
        ]),
        markEmailThreadSeen: entityFromArgument('GraphqlSoupEmailThread', [
          'input',
          'threadId',
        ]),
      },
    } satisfies EntityResolverConfig;

    const wire = compileEntityResolvers(config);
    expect(wire).toEqual([
      {
        parentType: 'CompleteMutationRoot',
        fieldName: 'markEmailThreadSeen',
        targetType: 'GraphqlSoupEmailThread',
        argumentPath: ['input', 'threadId'],
      },
      {
        parentType: 'CompleteMutationRoot',
        fieldName: 'updateEmailThreadLabel',
        targetType: 'GraphqlSoupEmailThread',
        argumentPath: ['input', 'labelId'],
      },
      {
        parentType: 'GraphqlUser',
        fieldName: 'emailThread',
        targetType: 'GraphqlSoupEmailThread',
        argumentPath: ['input', 'threadId'],
      },
    ]);
    expect(Object.isFrozen(wire)).toBe(true);
    expect(Object.isFrozen(wire[0])).toBe(true);
    expect(Object.isFrozen(wire[0]?.argumentPath)).toBe(true);
    expect(compileEntityResolvers()).toBe(compileEntityResolvers());
  });

  it.each([
    [null, 'configuration must be an object'],
    [{ Nope: {} }, 'unknown parent type'],
    [{ constructor: {} }, 'unknown parent type'],
    [{ GraphqlUser: null }, 'must map fields to descriptors'],
    [{ GraphqlUser: { nope: {} } }, 'unknown or ineligible field'],
    [{ GraphqlUser: { constructor: {} } }, 'unknown or ineligible field'],
    [{ GraphqlUser: { emailThread: null } }, 'must be a descriptor'],
    [
      {
        GraphqlUser: {
          emailThread: {
            kind: 'other',
            targetType: 'GraphqlSoupEmailThread',
            argumentPath: ['input', 'threadId'],
          },
        },
      },
      'unsupported resolver kind',
    ],
    [
      {
        GraphqlUser: {
          emailThread: {
            kind: 'entity-from-argument',
            targetType: 'GraphqlProperty',
            argumentPath: ['input', 'threadId'],
          },
        },
      },
      'cannot target',
    ],
    [
      {
        GraphqlUser: {
          emailThread: {
            kind: 'entity-from-argument',
            targetType: 'GraphqlSoupEmailThread',
            argumentPath: ['input', 'channelId'],
          },
        },
      },
      'does not have ID argument path',
    ],
    [
      {
        GraphqlUser: {
          emailThread: {
            kind: 'entity-from-argument',
            targetType: 'GraphqlSoupEmailThread',
            argumentPath: [],
          },
        },
      },
      'non-empty string array',
    ],
    [
      {
        GraphqlUser: {
          emailThread: {
            kind: 'entity-from-argument',
            targetType: 'GraphqlSoupEmailThread',
            argumentPath: ['input', 'threadId'],
            extra: true,
          },
        },
      },
      'must contain only',
    ],
  ])('rejects malformed runtime configuration %#', (value, message) => {
    expect(() =>
      compileEntityResolvers(value as unknown as EntityResolverConfig)
    ).toThrow(message as string);
  });
});
