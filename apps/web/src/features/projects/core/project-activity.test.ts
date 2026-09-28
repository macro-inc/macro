import { describe, expect, it } from 'vitest';
import { projectActivityEvent } from './project-activity';

const record = {
  id: 'event',
  actorId: 'actor',
  occurredAt: '2026-09-22T12:00:00Z',
};
describe('project history projection', () => {
  it('preserves transitions and authorized task references', () => {
    expect(
      projectActivityEvent('project', {
        ...record,
        action: 'property_changed',
        actionPayload: { property: 'status', from: 'todo', to: 'done' },
      }).action
    ).toEqual({
      kind: 'property-changed',
      property: 'status',
      from: 'todo',
      to: 'done',
    });
    expect(
      projectActivityEvent('project', {
        ...record,
        action: 'task_removed',
        actionPayload: { task_id: 'task' },
      })
    ).toMatchObject({
      entityId: 'task',
      entityType: 'document',
      action: { kind: 'task-removed', taskId: 'task' },
    });
  });
  it('keeps unknown and missing payloads on the project without treating arbitrary fields as task links', () => {
    expect(
      projectActivityEvent('project', {
        ...record,
        action: 'future_action',
        actionPayload: { task_id: 'private-task' },
      })
    ).toMatchObject({
      entityId: 'project',
      entityType: 'initiative',
      action: { kind: 'unknown', tag: 'future_action' },
    });
    expect(
      projectActivityEvent('project', {
        ...record,
        action: 'property_changed',
        actionPayload: null,
      }).action
    ).toEqual({ kind: 'unknown', tag: 'property_changed' });
  });
});
