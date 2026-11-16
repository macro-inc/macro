import { describe, expect, it } from 'vitest';
import {
  showInlineProjectTaskAction,
  showProjectTaskAction,
} from './project-task-action';

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
  it('keeps an inline action for short task lists after measurement', () => {
    expect(showInlineProjectTaskAction(0, 640)).toBe(false);
    expect(showInlineProjectTaskAction(240, 0)).toBe(false);
    expect(showInlineProjectTaskAction(240, 640)).toBe(true);
    expect(showInlineProjectTaskAction(640, 640)).toBe(false);
    expect(showInlineProjectTaskAction(900, 640)).toBe(false);
  });
});
