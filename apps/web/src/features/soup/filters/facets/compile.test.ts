import { describe, expect, it } from 'vitest';
import {
  clause,
  combine,
  compileFacets,
  type Facet,
  type FacetClause,
  type FacetOption,
  literal,
  mergeAst,
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
