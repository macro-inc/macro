import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_SETTINGS } from './project';
import {
  captureProjectSavedView,
  decodeProjectSavedView,
  projectSavedViewsEqual,
  readProjectSavedView,
} from './project-saved-view';

describe('project saved views', () => {
  it('captures filters, viewer-relative scope, grouping, sort and raw layout', () => {
    const captured = captureProjectSavedView(
      {
        ...DEFAULT_PROJECT_SETTINGS,
        status: 'active',
        priority: 'high',
        mine: true,
        dueAfter: '2026-04-01',
        dueBefore: '2026-04-30',
        sort: 'created',
        groupBy: 'assignee',
        layout: 'gantt',
      },
      'created-by-me'
    );
    expect(captured.isOk()).toBe(true);
    if (captured.isErr()) return;
    const restored = readProjectSavedView(captured.value);
    expect(restored.issues).toEqual([]);
    expect(restored.config).toEqual(captured.value);
    expect(restored.config.settings.layout).toBe('gantt');
    expect(restored.config.scope).toBe('created-by-me');
    expect(projectSavedViewsEqual(restored.config, captured.value)).toBe(true);
  });

  it('rejects invalid or reversed calendar bounds before saving', () => {
    expect(
      captureProjectSavedView(
        { ...DEFAULT_PROJECT_SETTINGS, dueAfter: '2026-02-30' },
        'all'
      ).isErr()
    ).toBe(true);
    expect(
      captureProjectSavedView(
        {
          ...DEFAULT_PROJECT_SETTINGS,
          dueAfter: '2026-05-01',
          dueBefore: '2026-04-01',
        },
        'all'
      ).isErr()
    ).toBe(true);
  });

  it('diagnoses other kinds and future definitions without rewriting them', () => {
    const input = {
      kind: 'projects',
      version: 2,
      scope: 'all',
      settings: { ...DEFAULT_PROJECT_SETTINGS },
    };
    expect(readProjectSavedView(input).issues).toHaveLength(1);
    expect(input.version).toBe(2);
    expect(
      decodeProjectSavedView({ ...input, kind: 'tasks', version: 1 }).isErr()
    ).toBe(true);
  });
});
