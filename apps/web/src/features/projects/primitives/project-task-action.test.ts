import { describe, expect, it } from 'vitest';
import { showProjectTaskAction } from './project-task-action';

describe('project floating Task action', () => {
  it('waits for task content to fill the viewport', () => {
    expect(showProjectTaskAction(0, 360)).toBe(false);
    expect(showProjectTaskAction(359, 360)).toBe(false);
    expect(showProjectTaskAction(360, 360)).toBe(true);
    expect(showProjectTaskAction(450, 360)).toBe(true);
  });

  it('hides again when returning to the summary or expanding the description', () => {
    expect(showProjectTaskAction(360, 360)).toBe(true);
    expect(showProjectTaskAction(360, 540)).toBe(false);
    expect(showProjectTaskAction(0, 540)).toBe(false);
    expect(showProjectTaskAction(0, 0)).toBe(false);
  });
});
