import { describe, expect, it } from 'vitest';
import { selectedHomeTypes, setHomeTypeSelected } from './type-selection';

const types = ['email', 'channels', 'documents'];

describe('Home entity type selection', () => {
  it('starts with every type checked and can hide one', () => {
    expect(selectedHomeTypes(undefined, types)).toEqual(types);
    expect(setHomeTypeSelected(undefined, types, 'email', false)).toEqual([
      'channels',
      'documents',
    ]);
  });
  it('can hide every type and then re-enable one', () => {
    let selection: string[] = [];
    for (const type of types)
      selection = setHomeTypeSelected(selection, types, type, false);
    expect(selectedHomeTypes(selection, types)).toEqual([]);
    expect(setHomeTypeSelected(selection, types, 'email', true)).toEqual([
      'email',
    ]);
  });
  it('returns to the unrestricted default when all types are checked', () => {
    expect(
      setHomeTypeSelected(['channels', 'documents'], types, 'email', true)
    ).toEqual([]);
  });
});
