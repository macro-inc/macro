import { describe, expect, it } from 'vitest';
import { NativeChecklistPlanState } from './native-plan-state';

const initial = {
  kind: 'delta',
  generation: 1,
  factsVersion: '1',
  sequence: '1',
  reset: true,
  lists: [
    {
      kind: 'replace',
      listKey: { index: 10, generation: 1 },
      result: {
        kind: 'planned',
        settings: {
          filters: { status: [], priority: [], assignees: [], due: [] },
        },
        active: false,
        filterCount: 0,
        hasTasks: true,
        progress: { done: 0, total: 1, ratio: 0, percentage: 0 },
        items: [
          {
            key: { index: 12, generation: 1 },
            taskId: { kind: 'value', value: 'task-a' },
            assignees: [
              {
                id: { kind: 'value', value: 'assignee-a' },
                name: 'Initial name',
              },
            ],
          },
        ],
        rows: [{ key: { index: 12, generation: 1 }, dimmed: false }],
      },
    },
  ],
};

describe('native checklist delivery metadata', () => {
  it('applies the exact ordered patch and reported progress without planning', () => {
    const state = new NativeChecklistPlanState();
    expect(state.receive(initial, 1)).toBe('updated');
    state.receive(
      {
        kind: 'delta',
        generation: 1,
        factsVersion: '2',
        sequence: '2',
        reset: false,
        lists: [
          {
            kind: 'patch',
            listKey: { index: 10, generation: 1 },
            changes: {
              active: true,
              filterCount: 1,
              progress: { done: 1, total: 2, ratio: 0.5, percentage: 50 },
              rows: [
                {
                  kind: 'place',
                  key: { index: 15, generation: 1 },
                  after: { index: 12, generation: 1 },
                  dimmed: false,
                },
                {
                  kind: 'dim',
                  key: { index: 12, generation: 1 },
                  dimmed: true,
                },
              ],
              items: [
                {
                  kind: 'place',
                  after: { index: 12, generation: 1 },
                  item: {
                    key: { index: 15, generation: 1 },
                    taskId: { kind: 'null' },
                    assignees: [],
                  },
                },
                {
                  kind: 'update',
                  item: {
                    key: { index: 12, generation: 1 },
                    taskId: { kind: 'value', value: 'task-a' },
                    assignees: [
                      {
                        id: { kind: 'value', value: 'assignee-a' },
                        name: 'Renamed',
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
      1
    );
    expect(state.current().get(10)?.result).toMatchObject({
      kind: 'planned',
      active: true,
      filterCount: 1,
      progress: { done: 1, total: 2, ratio: 0.5, percentage: 50 },
      rows: [
        { key: { index: 12, generation: 1 }, dimmed: true },
        { key: { index: 15, generation: 1 }, dimmed: false },
      ],
      items: [{ assignees: [{ name: 'Renamed' }] }, { assignees: [] }],
    });
  });
  it('accepts identical retained delivery once and refuses conflicting sequence reuse', () => {
    const state = new NativeChecklistPlanState();
    state.receive(initial, 1);
    const before = state.current();
    expect(state.receive(initial, 1)).toBe('duplicate');
    expect(state.current()).toBe(before);
    expect(() => state.receive({ ...initial, factsVersion: '2' }, 1)).toThrow(
      'Conflicting checklist delivery sequence'
    );
  });
  it('retains the baseline when a later patch operation is invalid', () => {
    const state = new NativeChecklistPlanState();
    state.receive(initial, 1);
    const before = state.current();
    expect(() =>
      state.receive(
        {
          kind: 'delta',
          generation: 1,
          factsVersion: '1',
          sequence: '2',
          reset: false,
          lists: [
            {
              kind: 'patch',
              listKey: { index: 10, generation: 1 },
              changes: {
                rows: [
                  {
                    kind: 'dim',
                    key: { index: 12, generation: 1 },
                    dimmed: true,
                  },
                  { kind: 'remove', key: { index: 99, generation: 1 } },
                ],
              },
            },
          ],
        },
        1
      )
    ).toThrow('unknown key');
    expect(state.current()).toBe(before);
    expect(state.current().get(10)?.result).toMatchObject({
      rows: [{ dimmed: false }],
    });
  });
  it('consumes retained old-generation receipts across packets before a real current reset', () => {
    const state = new NativeChecklistPlanState();
    expect(state.receive(initial, 2)).toBe('different-generation');
    expect(state.current().size).toBe(0);
    expect(
      state.receive(
        {
          kind: 'delta',
          generation: 1,
          factsVersion: '1',
          sequence: '2',
          reset: false,
          lists: [],
        },
        2
      )
    ).toBe('different-generation');
    state.receive({ kind: 'cleared', generation: 2, sequence: '3' }, 2);
    state.receive(
      {
        kind: 'delta',
        generation: 2,
        factsVersion: '2',
        sequence: '4',
        reset: true,
        lists: [
          {
            kind: 'replace',
            listKey: { index: 20, generation: 2 },
            result: {
              kind: 'unsupportedInput',
              field: 'filters.status',
              settingsContext: { filters: { status: 42 } },
            },
          },
        ],
      },
      2
    );
    expect([...state.current().keys()]).toEqual([20]);
    expect(state.current().get(20)?.result).toEqual({
      kind: 'unsupportedInput',
      field: 'filters.status',
      settingsContext: { filters: { status: 42 } },
    });
  });
  it('requires a real reset and refuses current-generation receipt gaps', () => {
    const cold = new NativeChecklistPlanState();
    expect(() => cold.receive({ ...initial, reset: false }, 1)).toThrow(
      'requires a current-generation reset'
    );
    const state = new NativeChecklistPlanState();
    state.receive(initial, 1);
    expect(() => state.receive({ ...initial, sequence: '3' }, 1)).toThrow(
      'sequence gap'
    );
    expect(state.current().size).toBe(1);
  });
  it('never defaults missing required facts or accepts stale row authority', () => {
    const state = new NativeChecklistPlanState();
    expect(() =>
      state.receive(
        { kind: 'delta', generation: 1, sequence: '1', reset: true, lists: [] },
        1
      )
    ).toThrow();
    state.receive(initial, 1);
    expect(() =>
      state.receive(
        {
          kind: 'delta',
          generation: 1,
          factsVersion: '1',
          sequence: '2',
          reset: false,
          lists: [
            {
              kind: 'patch',
              listKey: { index: 10, generation: 1 },
              changes: {
                rows: [
                  {
                    kind: 'dim',
                    key: { index: 12, generation: 2 },
                    dimmed: true,
                  },
                ],
              },
            },
          ],
        },
        1
      )
    ).toThrow('stale key');
  });
  it('releases terminal presentation data without reopening a retired receiver', () => {
    const state = new NativeChecklistPlanState();
    state.receive(initial, 1);
    state.retire();
    expect(state.current().size).toBe(0);
    expect(() => state.receive(initial, 1)).toThrow('presentation is retired');
  });
});

it('exposes only an actual decoded current-generation reset sequence for settings intents', () => {
  const state = new NativeChecklistPlanState();
  expect(state.observedSequence(1)).toBeUndefined();
  state.receive(initial, 2);
  expect(state.observedSequence(2)).toBeUndefined();
  state.receive({ kind: 'cleared', generation: 2, sequence: '2' }, 2);
  expect(state.observedSequence(2)).toBeUndefined();
  state.receive(
    {
      kind: 'delta',
      generation: 2,
      factsVersion: '1',
      sequence: '3',
      reset: true,
      lists: [],
    },
    2
  );
  expect(state.observedSequence(2)).toBe('3');
  expect(state.observedSequence(3)).toBeUndefined();
  state.retire();
  expect(state.observedSequence(2)).toBeUndefined();
});
