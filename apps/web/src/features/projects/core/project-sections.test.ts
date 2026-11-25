import { describe, expect, it } from 'vitest';
import { projectSections, shownProjectSection } from './project';

describe('project sections', () => {
  it('offers Time only while time tracking is on', () => {
    expect(projectSections(true)).toEqual(['overview', 'tasks', 'time']);
    expect(projectSections(false)).toEqual(['overview', 'tasks']);
  });

  it('shows a Time link as the Overview once time tracking is known to be off', () => {
    expect(
      shownProjectSection('time', { enabled: false, loading: false })
    ).toBe('overview');
    expect(shownProjectSection('time', { enabled: false, loading: true })).toBe(
      'time'
    );
    expect(shownProjectSection('time', { enabled: true, loading: false })).toBe(
      'time'
    );
    expect(
      shownProjectSection('tasks', { enabled: false, loading: false })
    ).toBe('tasks');
  });
});
