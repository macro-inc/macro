import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { describe, expect, it } from 'vitest';
import { taskProjectId, taskProjectValue } from './task-project';

describe('task Project property', () => {
  it('builds the value naming a project, or clearing it', () => {
    expect(taskProjectValue('initiative')).toEqual({
      valueType: 'ENTITY',
      refs: [{ entity_id: 'initiative', entity_type: 'INITIATIVE' }],
    });
    expect(taskProjectValue()).toEqual({ valueType: 'ENTITY', refs: null });
  });

  it("reads the project a task's properties name", () => {
    const project = {
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
      valueType: 'ENTITY',
      value: [{ entity_id: 'initiative', entity_type: 'INITIATIVE' }],
    } as Property;
    expect(taskProjectId([project])).toBe('initiative');
    expect(taskProjectId([{ ...project, value: null } as Property])).toBe(
      undefined
    );
    expect(taskProjectId([])).toBe(undefined);
  });
});
