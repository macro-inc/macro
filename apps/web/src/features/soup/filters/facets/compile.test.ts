import { describe, expect, it } from 'vitest';
import {
  clause,
  combine,
  compileFacets,
  confine,
  type Facet,
  type FacetClause,
  type FacetOption,
  literal,
  mergeAst,
  NIL_UUID,
} from '.';

type Item = { status: string };
type Context = { propertyId: string };
type Option = FacetOption<Item, Context>;

const selectClause = (propertyId: string, optionId: string): FacetClause => ({
  propf: clause.eq('properties', {
    propertyId,
    type: 'select',
    value: optionId,
  }),
});

const facets: Facet<Item, Context, Option>[] = [
  {
    id: 'status',
    mode: 'or',
    options: [
      { id: 'open', clause: selectClause('status-property', 'open-option') },
      {
        id: 'closed',
        clause: selectClause('status-property', 'closed-option'),
      },
    ],
  },
  {
    id: 'priority',
    mode: 'or',
    options: (optionId, context) => ({
      id: optionId,
      clause: selectClause(context.propertyId, optionId),
    }),
  },
];

const confinedFacet: Facet<Item, undefined> = {
  id: 'type',
  mode: 'or',
  options: [
    {
      id: 'documents',
      clause: confine({ df: clause.eq('subType', ['task']) }),
    },
    {
      id: 'email',
      clause: confine({ ef: clause.eq('emailSeen', false) }),
    },
  ],
};

const propertyLiteral = (propertyId: string, optionId: string) => ({
  l: { pd: propertyId, v: { so: optionId } },
});

describe('facet compiler', () => {
  it('combines options with the facet mode and facets with AND', () => {
    expect(
      compileFacets(
        { status: ['open', 'closed'], priority: ['high'] },
        facets,
        { propertyId: 'priority-property' }
      ).propf
    ).toEqual({
      '&': [
        {
          '|': [
            propertyLiteral('status-property', 'closed-option'),
            propertyLiteral('status-property', 'open-option'),
          ],
        },
        propertyLiteral('priority-property', 'high'),
      ],
    });
  });

  it('leaves unknown facets and unresolved options inert', () => {
    expect(
      compileFacets({ unknown: ['value'], status: ['missing'] }, facets, {
        propertyId: 'priority-property',
      })
    ).toEqual({});
  });

  it('leaves unresolved restricting options inert', () => {
    expect(
      compileFacets(
        { type: ['missing'] },
        [
          {
            id: 'type',
            mode: 'or',
            restrict: true,
            options: [
              {
                id: 'documents',
                clause: { df: clause.eq('documentId', ['document-id']) },
              },
            ],
          },
        ],
        undefined
      )
    ).toEqual({});
  });

  it('keeps each target admitted by confined OR options', () => {
    const result = compileFacets(
      { type: ['documents', 'email'] },
      [confinedFacet],
      undefined
    );

    expect(result.df).toEqual({
      '|': [{ l: { dst: ['task'] } }, { l: { id: NIL_UUID } }],
    });
    expect(result.ef).toEqual({
      '|': [{ l: { ThreadId: NIL_UUID } }, { l: { Read: false } }],
    });
  });

  it('builds and combines transport-neutral AST nodes', () => {
    expect(
      combine('&', [literal('dst', 'task'), literal('o', 'user-id')])
    ).toEqual({
      '&': [{ l: { dst: 'task' } }, { l: { o: 'user-id' } }],
    });
    expect(combine('|', [])).toBeUndefined();
  });

  it('merges compiled maps without owning request transport', () => {
    expect(
      mergeAst({ df: { l: { dst: 'task' } } }, { df: { l: { o: 'user-id' } } })
    ).toEqual({
      df: {
        '&': [{ l: { dst: 'task' } }, { l: { o: 'user-id' } }],
      },
    });
  });
});

describe('GitHub repository ID precision', () => {
  const compileRepository = (value: unknown) =>
    compileFacets(
      { repository: ['selected'] },
      [
        {
          id: 'repository',
          mode: 'or',
          options: [
            {
              id: 'selected',
              clause: {
                ghprf: clause.eq('githubPullRequestRepositoryId', value),
              },
            },
          ],
        },
      ],
      undefined
    );

  it.each(['42', 42, '9007199254740991'])(
    'preserves a safely representable ID: %s',
    (id) => {
      expect(compileRepository(id)).toEqual({
        ghprf: { l: { repo: Number(id) } },
      });
    }
  );

  it.each([
    '9007199254740993',
    '9223372036854775807',
    9007199254740992,
    '1.5',
    '',
    null,
  ])('rejects IDs instead of silently rounding or coercing: %s', (id) => {
    expect(() => compileRepository(id)).toThrow(
      'GitHub repository ID must be a positive safe integer'
    );
  });
});
