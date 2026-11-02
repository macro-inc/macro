import { expect, it } from 'vitest';
import { taskListColumns } from '../components/task-list/task-grid-template';
import {
  DEFAULT_TASK_PROPERTY_DISPLAY,
  showTaskProperty,
} from './task-property-display';

it('distinguishes empty-only hiding from hiding every value', () => {
  expect(showTaskProperty('show', false)).toBe(true);
  expect(showTaskProperty('hide_when_empty', false)).toBe(false);
  expect(showTaskProperty('hide_when_empty', true)).toBe(true);
  expect(showTaskProperty('hide', true)).toBe(false);
});

it('removes hidden tracks without moving empty-only tracks or mandatory task content', () => {
  expect(
    taskListColumns(
      {
        ...DEFAULT_TASK_PROPERTY_DISPLAY,
        dueDate: 'hide_when_empty',
        project: 'hide',
        assignees: 'hide',
        updated: 'hide',
        createdBy: 'hide',
      },
      true
    )
  ).toEqual(['indicator', 'content', 'dueDate']);
  expect(taskListColumns(DEFAULT_TASK_PROPERTY_DISPLAY, false)).not.toContain(
    'initiative'
  );
});
