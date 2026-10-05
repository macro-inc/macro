import { describe, expect, it } from 'vitest';
import { taskProjectValue } from './task-project';

describe('task Project property', () => {
  it('builds the value naming a project, or clearing it', () => {
    expect(taskProjectValue('initiative')).toEqual({
      valueType: 'ENTITY',
      refs: [{ entity_id: 'initiative', entity_type: 'INITIATIVE' }],
    });
    expect(taskProjectValue()).toEqual({ valueType: 'ENTITY', refs: null });
  });
});
