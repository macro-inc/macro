import { describe, expect, it } from 'vitest';
import {
  isProjectTab,
  normalizeTaskTab,
  projectTabForScope,
  TASK_TAB_IDS,
} from './task-navigation';

describe('legacy task navigation', () => {
  it.each([
    ['created-by-me', 'my-tasks'],
    ['created-projects', 'my-projects'],
  ])('maps %s to %s', (legacy, current) => {
    expect(normalizeTaskTab(legacy)).toBe(current);
    expect(TASK_TAB_IDS).not.toContain(legacy);
  });

  it('maps the surviving project scope to My projects', () => {
    expect(projectTabForScope('assigned-to-me')).toBe('my-projects');
    expect(isProjectTab('created-projects')).toBe(false);
  });
});
