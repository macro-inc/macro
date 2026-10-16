import { describe, expect, it } from 'vitest';
import type { FormCellValue, GateRules, GateTest } from './form-model';
import { gatePasses } from './gate-evaluation';

const TEAM = '01920000-0000-7000-8000-00000000000a';
const START = '01920000-0000-7000-8000-00000000000b';
const CONTRACTOR = '01920000-0000-7000-8000-0000000000c1';
const EMPLOYEE = '01920000-0000-7000-8000-0000000000c2';

describe('gatePasses', () => {
  it('passes "Team is not Contractor AND Start date is before Sep 1, 2026" for an employee starting in August', () => {
    const rules: GateRules = {
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: TEAM,
          test: {
            kind: 'options',
            operator: 'isNoneOf',
            options: [CONTRACTOR],
          },
        },
        {
          kind: 'condition',
          column: START,
          test: {
            kind: 'date',
            operator: 'before',
            value: '2026-09-01T00:00:00Z',
          },
        },
      ],
    };
    const answers = new Map<string, FormCellValue>([
      [TEAM, { type: 'options', value: [{ id: EMPLOYEE }] }],
      [START, { type: 'date', value: '2026-08-15T09:00:00Z' }],
    ]);

    expect(gatePasses(rules, answers)).toBe(true);
    expect(
      gatePasses(
        rules,
        new Map<string, FormCellValue>([
          [TEAM, { type: 'options', value: [{ id: CONTRACTOR }] }],
          [START, { type: 'date', value: '2026-08-15T09:00:00Z' }],
        ])
      )
    ).toBe(false);
  });

  const COLUMN = '01920000-0000-7000-8000-0000000000aa';
  const RED = '01920000-0000-7000-8000-0000000000d1';
  const BLUE = '01920000-0000-7000-8000-0000000000d2';
  const GREEN = '01920000-0000-7000-8000-0000000000d3';
  const ALICE = 'macro|alice@example.com';
  const BOB = 'macro|bob@example.com';

  type Case = {
    test: GateTest;
    value: FormCellValue;
    passes: boolean;
  };

  /**
   * Every test against a value that fits it. Absent and cleared answers are
   * covered below: they fail every test but `isEmpty`.
   */
  const present: Case[] = [
    {
      test: { kind: 'presence', operator: 'isEmpty' },
      value: { type: 'text', value: 'x' },
      passes: false,
    },
    {
      test: { kind: 'presence', operator: 'isNotEmpty' },
      value: { type: 'text', value: 'x' },
      passes: true,
    },
    {
      test: { kind: 'presence', operator: 'isNotEmpty' },
      value: { type: 'boolean', value: false },
      passes: true,
    },
    {
      test: { kind: 'text', operator: 'is', value: 'HELLO' },
      value: { type: 'text', value: 'hello' },
      passes: true,
    },
    {
      test: { kind: 'text', operator: 'is', value: 'hello' },
      value: { type: 'text', value: 'hello world' },
      passes: false,
    },
    {
      test: { kind: 'text', operator: 'isNot', value: 'Hello' },
      value: { type: 'text', value: 'hello' },
      passes: false,
    },
    {
      test: { kind: 'text', operator: 'isNot', value: 'bye' },
      value: { type: 'text', value: 'hello' },
      passes: true,
    },
    {
      test: { kind: 'text', operator: 'contains', value: 'LO WO' },
      value: { type: 'text', value: 'Hello World' },
      passes: true,
    },
    {
      test: { kind: 'text', operator: 'contains', value: 'xyz' },
      value: { type: 'text', value: 'Hello World' },
      passes: false,
    },
    {
      test: { kind: 'text', operator: 'doesNotContain', value: 'WORLD' },
      value: { type: 'text', value: 'Hello World' },
      passes: false,
    },
    {
      test: { kind: 'text', operator: 'doesNotContain', value: 'xyz' },
      value: { type: 'text', value: 'Hello World' },
      passes: true,
    },
    {
      test: { kind: 'text', operator: 'startsWith', value: 'hel' },
      value: { type: 'text', value: 'Hello' },
      passes: true,
    },
    {
      test: { kind: 'text', operator: 'startsWith', value: 'llo' },
      value: { type: 'text', value: 'Hello' },
      passes: false,
    },
    {
      test: { kind: 'text', operator: 'endsWith', value: 'LLO' },
      value: { type: 'text', value: 'Hello' },
      passes: true,
    },
    {
      test: { kind: 'text', operator: 'endsWith', value: 'hel' },
      value: { type: 'text', value: 'Hello' },
      passes: false,
    },
    {
      test: { kind: 'text', operator: 'contains', value: 'EXAMPLE' },
      value: { type: 'link', value: ['https://example.com/a'] },
      passes: true,
    },
    {
      test: { kind: 'text', operator: 'doesNotContain', value: 'example' },
      value: {
        type: 'link',
        value: ['https://macro.com', 'https://example.com'],
      },
      passes: false,
    },
    {
      test: { kind: 'number', operator: 'is', value: 3 },
      value: { type: 'number', value: 3 },
      passes: true,
    },
    {
      test: { kind: 'number', operator: 'is', value: 3 },
      value: { type: 'number', value: 4 },
      passes: false,
    },
    {
      test: { kind: 'number', operator: 'isNot', value: 3 },
      value: { type: 'number', value: 4 },
      passes: true,
    },
    {
      test: { kind: 'number', operator: 'isNot', value: 3 },
      value: { type: 'number', value: 3 },
      passes: false,
    },
    {
      test: { kind: 'number', operator: 'greaterThan', value: 3 },
      value: { type: 'number', value: 3 },
      passes: false,
    },
    {
      test: { kind: 'number', operator: 'greaterThan', value: 3 },
      value: { type: 'number', value: 3.5 },
      passes: true,
    },
    {
      test: { kind: 'number', operator: 'greaterThanOrEqual', value: 3 },
      value: { type: 'number', value: 3 },
      passes: true,
    },
    {
      test: { kind: 'number', operator: 'greaterThanOrEqual', value: 3 },
      value: { type: 'number', value: 2 },
      passes: false,
    },
    {
      test: { kind: 'number', operator: 'lessThan', value: 3 },
      value: { type: 'number', value: 3 },
      passes: false,
    },
    {
      test: { kind: 'number', operator: 'lessThan', value: 3 },
      value: { type: 'number', value: -1 },
      passes: true,
    },
    {
      test: { kind: 'number', operator: 'lessThanOrEqual', value: 3 },
      value: { type: 'number', value: 3 },
      passes: true,
    },
    {
      test: { kind: 'number', operator: 'lessThanOrEqual', value: 3 },
      value: { type: 'number', value: 4 },
      passes: false,
    },
    {
      test: { kind: 'date', operator: 'before', value: '2026-09-01T00:00:00Z' },
      value: { type: 'date', value: '2026-09-01T00:00:00Z' },
      passes: false,
    },
    {
      test: { kind: 'date', operator: 'before', value: '2026-09-01T00:00:00Z' },
      value: { type: 'date', value: '2026-08-31T23:59:59Z' },
      passes: true,
    },
    {
      test: { kind: 'date', operator: 'after', value: '2026-09-01T00:00:00Z' },
      value: { type: 'date', value: '2026-09-01T00:00:00Z' },
      passes: false,
    },
    {
      test: { kind: 'date', operator: 'after', value: '2026-09-01T00:00:00Z' },
      value: { type: 'date', value: '2026-09-01T00:00:01Z' },
      passes: true,
    },
    {
      test: {
        kind: 'date',
        operator: 'onOrBefore',
        value: '2026-09-01T00:00:00Z',
      },
      value: { type: 'date', value: '2026-09-01T00:00:00.000Z' },
      passes: true,
    },
    {
      test: {
        kind: 'date',
        operator: 'onOrBefore',
        value: '2026-09-01T00:00:00Z',
      },
      value: { type: 'date', value: '2026-09-02T00:00:00Z' },
      passes: false,
    },
    {
      test: {
        kind: 'date',
        operator: 'onOrAfter',
        value: '2026-09-01T00:00:00Z',
      },
      value: { type: 'date', value: '2026-09-01T00:00:00Z' },
      passes: true,
    },
    {
      test: {
        kind: 'date',
        operator: 'onOrAfter',
        value: '2026-09-01T00:00:00Z',
      },
      value: { type: 'date', value: '2026-08-01T00:00:00Z' },
      passes: false,
    },
    {
      test: { kind: 'checkbox', checked: true },
      value: { type: 'boolean', value: true },
      passes: true,
    },
    {
      test: { kind: 'checkbox', checked: true },
      value: { type: 'boolean', value: false },
      passes: false,
    },
    {
      test: { kind: 'checkbox', checked: false },
      value: { type: 'boolean', value: false },
      passes: true,
    },
    {
      test: { kind: 'checkbox', checked: false },
      value: { type: 'boolean', value: true },
      passes: false,
    },
    {
      test: { kind: 'options', operator: 'isAnyOf', options: [RED, BLUE] },
      value: { type: 'options', value: [{ id: BLUE }] },
      passes: true,
    },
    {
      test: { kind: 'options', operator: 'isAnyOf', options: [RED, BLUE] },
      value: { type: 'options', value: [{ id: GREEN }] },
      passes: false,
    },
    {
      test: { kind: 'options', operator: 'isNoneOf', options: [RED, BLUE] },
      value: { type: 'options', value: [{ id: GREEN }] },
      passes: true,
    },
    {
      test: { kind: 'options', operator: 'isNoneOf', options: [RED, BLUE] },
      value: { type: 'options', value: [{ id: RED }] },
      passes: false,
    },
    {
      test: { kind: 'options', operator: 'hasAny', options: [RED, BLUE] },
      value: { type: 'options', value: [{ id: GREEN }, { id: BLUE }] },
      passes: true,
    },
    {
      test: { kind: 'options', operator: 'hasAny', options: [RED, BLUE] },
      value: { type: 'options', value: [{ id: GREEN }] },
      passes: false,
    },
    {
      test: { kind: 'options', operator: 'hasAll', options: [RED, BLUE] },
      value: {
        type: 'options',
        value: [{ id: BLUE }, { id: GREEN }, { id: RED }],
      },
      passes: true,
    },
    {
      test: { kind: 'options', operator: 'hasAll', options: [RED, BLUE] },
      value: { type: 'options', value: [{ id: RED }, { id: GREEN }] },
      passes: false,
    },
    {
      test: { kind: 'options', operator: 'hasNone', options: [RED, BLUE] },
      value: { type: 'options', value: [{ id: GREEN }] },
      passes: true,
    },
    {
      test: { kind: 'options', operator: 'hasNone', options: [RED, BLUE] },
      value: { type: 'options', value: [{ id: GREEN }, { id: RED }] },
      passes: false,
    },
    {
      test: { kind: 'entities', operator: 'isAnyOf', entities: [ALICE] },
      value: {
        type: 'entities',
        value: [{ entityType: 'USER', entityId: ALICE }],
      },
      passes: true,
    },
    {
      test: { kind: 'entities', operator: 'isNoneOf', entities: [ALICE] },
      value: {
        type: 'entities',
        value: [{ entityType: 'USER', entityId: ALICE }],
      },
      passes: false,
    },
    {
      test: { kind: 'entities', operator: 'hasAll', entities: [ALICE, BOB] },
      value: {
        type: 'entities',
        value: [
          { entityType: 'USER', entityId: BOB },
          { entityType: 'USER', entityId: ALICE },
        ],
      },
      passes: true,
    },
    {
      test: { kind: 'entities', operator: 'hasNone', entities: [ALICE] },
      value: {
        type: 'entities',
        value: [{ entityType: 'USER', entityId: BOB }],
      },
      passes: true,
    },
    {
      test: { kind: 'entities', operator: 'hasAny', entities: [RED] },
      value: { type: 'rows', value: [GREEN, RED] },
      passes: true,
    },
    {
      test: { kind: 'entities', operator: 'isNoneOf', entities: [RED] },
      value: { type: 'rows', value: [GREEN] },
      passes: true,
    },
  ];

  const single = (test: GateTest): GateRules => ({
    conjunction: 'and',
    conditions: [{ kind: 'condition', column: COLUMN, test }],
  });

  it.each(present)(
    '$test.kind $test.operator against a present answer',
    ({ test, value, passes }) => {
      expect(gatePasses(single(test), new Map([[COLUMN, value]]))).toBe(passes);
    }
  );

  const everyTest: GateTest[] = [
    ...new Map(
      present.map(({ test }) => [JSON.stringify(test), test] as const)
    ).values(),
  ];

  it.each(everyTest)(
    '$kind fails an absent answer unless it asks for empty',
    (test) => {
      const expected = test.kind === 'presence' && test.operator === 'isEmpty';
      expect(gatePasses(single(test), new Map())).toBe(expected);
    }
  );

  it.each(everyTest)(
    '$kind fails a cleared answer unless it asks for empty',
    (test) => {
      const expected = test.kind === 'presence' && test.operator === 'isEmpty';
      expect(
        gatePasses(single(test), new Map([[COLUMN, { type: 'clear' }]]))
      ).toBe(expected);
    }
  );

  it('treats blank text or an empty list as no answer', () => {
    expect(
      gatePasses(
        single({ kind: 'presence', operator: 'isEmpty' }),
        new Map([[COLUMN, { type: 'text', value: '  \t ' }]])
      )
    ).toBe(true);
    expect(
      gatePasses(
        single({ kind: 'text', operator: 'isNot', value: 'x' }),
        new Map([[COLUMN, { type: 'text', value: '   ' }]])
      )
    ).toBe(false);
    expect(
      gatePasses(
        single({ kind: 'entities', operator: 'hasNone', entities: [ALICE] }),
        new Map([[COLUMN, { type: 'entities', value: [] }]])
      )
    ).toBe(false);
    const isEmpty = single({ kind: 'presence', operator: 'isEmpty' });
    expect(
      gatePasses(isEmpty, new Map([[COLUMN, { type: 'text', value: '' }]]))
    ).toBe(true);
    expect(
      gatePasses(isEmpty, new Map([[COLUMN, { type: 'options', value: [] }]]))
    ).toBe(true);
    expect(
      gatePasses(
        single({ kind: 'text', operator: 'isNot', value: 'x' }),
        new Map([[COLUMN, { type: 'text', value: '' }]])
      )
    ).toBe(false);
  });

  it('fails a test whose kind does not fit the answer', () => {
    expect(
      gatePasses(
        single({ kind: 'number', operator: 'isNot', value: 1 }),
        new Map([[COLUMN, { type: 'text', value: '2' }]])
      )
    ).toBe(false);
  });

  it('combines conditions with and/or and nests groups', () => {
    const other = '01920000-0000-7000-8000-0000000000bb';
    const answers = new Map<string, FormCellValue>([
      [COLUMN, { type: 'number', value: 5 }],
      [other, { type: 'text', value: 'yes' }],
    ]);
    const greaterThanTen: GateRules['conditions'][number] = {
      kind: 'condition',
      column: COLUMN,
      test: { kind: 'number', operator: 'greaterThan', value: 10 },
    };
    const saysYes: GateRules['conditions'][number] = {
      kind: 'condition',
      column: other,
      test: { kind: 'text', operator: 'is', value: 'YES' },
    };
    expect(
      gatePasses(
        { conjunction: 'and', conditions: [greaterThanTen, saysYes] },
        answers
      )
    ).toBe(false);
    expect(
      gatePasses(
        { conjunction: 'or', conditions: [greaterThanTen, saysYes] },
        answers
      )
    ).toBe(true);
    expect(
      gatePasses(
        {
          conjunction: 'and',
          conditions: [
            saysYes,
            {
              kind: 'group',
              conjunction: 'or',
              conditions: [greaterThanTen],
            },
          ],
        },
        answers
      )
    ).toBe(false);
  });

  it('passes a gate without rules', () => {
    expect(gatePasses({ conjunction: 'and', conditions: [] }, new Map())).toBe(
      true
    );
    expect(gatePasses({ conjunction: 'or', conditions: [] }, new Map())).toBe(
      true
    );
  });
});
