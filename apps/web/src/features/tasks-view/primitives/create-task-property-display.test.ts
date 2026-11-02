import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  DEFAULT_TASK_PROPERTY_DISPLAY,
  type TaskPropertyDisplay,
} from '../core/task-property-display';
import { createTaskPropertyDisplay } from './create-task-property-display';

const disposers: (() => void)[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function setup() {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [userId, setUserId] = createSignal<string | undefined>('viewer-a');
    const [active, setActive] = createSignal(false);
    const [saved, setSaved] = createSignal<TaskPropertyDisplay>({
      ...DEFAULT_TASK_PROPERTY_DISPLAY,
    });
    const display = createTaskPropertyDisplay({
      userId,
      savedViewActive: active,
      saved,
      setSaved,
    });
    return { display, setUserId, setActive, setSaved };
  });
}

it('shares and restores device preferences without saving saved-view edits into them', () => {
  const first = setup();
  const second = setup();
  first.display.set('dueDate', 'hide_when_empty');
  expect(second.display.value().dueDate).toBe('hide_when_empty');
  expect(setup().display.value().dueDate).toBe('hide_when_empty');

  first.setSaved({ ...DEFAULT_TASK_PROPERTY_DISPLAY, priority: 'hide' });
  first.setActive(true);
  expect(first.display.value().dueDate).toBe('show');
  first.display.set('tags', 'hide');
  expect(first.display.value().tags).toBe('hide');
  expect(second.display.value().tags).toBe('show');
  first.setActive(false);
  expect(first.display.value().dueDate).toBe('hide_when_empty');
  expect(first.display.value().tags).toBe('show');
  expect(setup().display.value().tags).toBe('show');
});

it('isolates device preferences by account and rejects unsupported property modes', () => {
  const fixture = setup();
  fixture.display.set('project', 'hide');
  fixture.display.set('tags', 'hide_when_empty');
  expect(fixture.display.value().tags).toBe('show');
  fixture.setUserId('viewer-b');
  expect(fixture.display.value().project).toBe('show');
  fixture.display.set('updated', 'hide');
  fixture.setUserId('viewer-a');
  expect(fixture.display.value().project).toBe('hide');
  expect(fixture.display.value().updated).toBe('show');
});

it('keeps valid preferences from damaged storage and defaults invalid modes', () => {
  localStorage.setItem(
    'macro:tasks:property-display:v1:viewer-a',
    JSON.stringify({
      priority: 'hide_when_empty',
      tags: 'hide_when_empty',
      updated: 'unknown',
    })
  );
  const fixture = setup();
  expect(fixture.display.value()).toEqual({
    ...DEFAULT_TASK_PROPERTY_DISPLAY,
    priority: 'hide_when_empty',
  });
});
