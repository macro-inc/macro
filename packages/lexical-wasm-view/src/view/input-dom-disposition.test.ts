import type { IViewEffectMsg } from '@macro-inc/collaboration/session/abi.generated';
import { describe, expect, test } from 'vitest';
import { inputDomDisposition } from './input-dom-disposition';

function effect(flag: boolean, detail: number): IViewEffectMsg {
  return {
    kind: 6,
    code: 12,
    flag,
    detail,
    request: 0,
    text: '',
    format: 0,
    style: '',
    keys: [],
    values: [],
    paths: [],
    events: [],
    closedReason: 0,
    saveReason: 0,
    selection: {
      kind: 0,
      anchor: { key: 0, offset: 0, type: 0 },
      focus: { key: 0, offset: 0, type: 0 },
      nodes: [],
      table: 0,
      dirty: false,
    },
  };
}

describe('typed input DOM disposition', () => {
  test('decodes all four actual bit pairs without treating handling as evidence', () => {
    for (const prevent of [false, true])
      for (const stop of [false, true]) {
        const decoded = inputDomDisposition([effect(prevent, stop ? 1 : 0)]);
        expect(decoded.disposition).toEqual({
          defaultPrevented: prevent,
          propagationStopped: stop,
        });
        expect(decoded.effects).toEqual([]);
        expect(decoded.present).toBe(true);
      }
    expect(inputDomDisposition([])).toEqual({
      disposition: {
        defaultPrevented: false,
        propagationStopped: false,
      },
      effects: [],
      present: false,
    });
  });
  test('rejects unknown stop values, duplicate and reserved data loudly', () => {
    expect(() => inputDomDisposition([effect(true, 2)])).toThrow(
      'Invalid input DOM disposition'
    );
    expect(() =>
      inputDomDisposition([effect(true, 1), effect(false, 1)])
    ).toThrow('Invalid input DOM disposition');
    for (const field of [
      { request: 1 },
      { format: 1 },
      { text: 'reserved' },
      { style: '{}' },
      { keys: ['reserved'] },
      { closedReason: 1 },
      { saveReason: 1 },
    ]) {
      expect(() =>
        inputDomDisposition([{ ...effect(true, 1), ...field }])
      ).toThrow('Invalid input DOM disposition');
    }
    const selected = effect(false, 1);
    expect(() =>
      inputDomDisposition([
        {
          ...selected,
          selection: {
            ...selected.selection,
            anchor: { key: 1, offset: 0, type: 0 },
          },
        },
      ])
    ).toThrow('Invalid input DOM disposition');
  });
  test('preserves all other effect identities and ordering including legacy prevention', () => {
    const before = { ...effect(false, 0), code: 2 };
    const after = { ...effect(false, 0), kind: 2, code: 0 };
    const decoded = inputDomDisposition([before, effect(true, 1), after]);
    expect(decoded.effects).toEqual([before, after]);
    expect(decoded.effects[0]).toBe(before);
    expect(decoded.effects[1]).toBe(after);
  });
});
