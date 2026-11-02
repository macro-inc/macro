import { describe, expect, test } from 'vitest';
import {
  DEFAULT_TASK_PROPERTY_DISPLAY,
  readTaskPropertyDisplay,
  taskPropertyDisplaySchema,
} from '../core/task-property-display';
import {
  captureTaskSavedView,
  decodeTaskSavedView,
  materializeTaskSavedView,
  readTaskSavedView,
  taskSavedViewsEqual,
} from './task-saved-view';

const emptyView = {
  kind: 'tasks',
  version: 1,
  filters: {
    statusOptionIds: [],
    priorityOptionIds: [],
    assignees: [],
    creators: [],
    tags: [],
  },
};

describe('task property display saved-view codec', () => {
  test('defaults every field when propertyDisplay is omitted', () => {
    const decoded = decodeTaskSavedView(emptyView);
    expect(decoded.isOk()).toBe(true);
    if (decoded.isErr()) return;

    expect(decoded.value.propertyDisplay).toEqual(
      DEFAULT_TASK_PROPERTY_DISPLAY
    );
    expect(materializeTaskSavedView(decoded.value).propertyDisplay).toEqual(
      DEFAULT_TASK_PROPERTY_DISPLAY
    );
    expect(readTaskSavedView(emptyView).config.propertyDisplay).toEqual(
      DEFAULT_TASK_PROPERTY_DISPLAY
    );
  });

  test('captures and materializes valid property display modes', () => {
    const captured = captureTaskSavedView({
      tab: 'team-tasks',
      facets: {},
      context: { tagPropertyDefinitionByOptionId: new Map() },
      propertyDisplay: {
        priority: 'hide_when_empty',
        tags: 'hide',
        dueDate: 'hide',
        project: 'hide_when_empty',
        assignees: 'hide',
        updated: 'show',
        createdBy: 'hide',
      },
    });
    expect(captured.isOk()).toBe(true);
    if (captured.isErr()) return;

    expect(captured.value.propertyDisplay).toEqual({
      priority: 'hide_when_empty',
      tags: 'hide',
      dueDate: 'hide',
      project: 'hide_when_empty',
      assignees: 'hide',
      updated: 'show',
      createdBy: 'hide',
    });
    expect(materializeTaskSavedView(captured.value).propertyDisplay).toEqual(
      captured.value.propertyDisplay
    );
  });

  test('compares normalized display modes in equality', () => {
    const defaults = readTaskSavedView(emptyView).config;
    const explicit = readTaskSavedView({
      ...emptyView,
      propertyDisplay: { tags: 'show' },
    }).config;
    const hidden = readTaskSavedView({
      ...emptyView,
      propertyDisplay: { tags: 'hide' },
    }).config;

    expect(taskSavedViewsEqual(defaults, explicit)).toBe(true);
    expect(taskSavedViewsEqual(defaults, hidden)).toBe(false);
  });

  test('rejects malformed modes and unknown keys in strict decoding', () => {
    expect(
      taskPropertyDisplaySchema.safeParse({ tags: 'hide_when_empty' }).success
    ).toBe(false);
    expect(
      taskPropertyDisplaySchema.safeParse({ unknown: 'hide' }).success
    ).toBe(false);
    expect(
      decodeTaskSavedView({
        ...emptyView,
        propertyDisplay: {
          priority: 'hide_when_empty',
          tags: 'hide_when_empty',
        },
      }).isErr()
    ).toBe(true);
  });

  test('retains valid modes and reports invalid fields in tolerant reading', () => {
    const read = readTaskSavedView({
      ...emptyView,
      propertyDisplay: {
        priority: 'hide_when_empty',
        tags: 'hide_when_empty',
        dueDate: 'hide',
        updated: false,
        unsupported: 'hide',
      },
    });

    expect(read.config.propertyDisplay).toEqual({
      ...DEFAULT_TASK_PROPERTY_DISPLAY,
      priority: 'hide_when_empty',
      dueDate: 'hide',
    });
    expect(read.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        ['propertyDisplay', 'tags'],
        ['propertyDisplay', 'updated'],
        ['propertyDisplay', 'unsupported'],
      ])
    );
    expect(readTaskPropertyDisplay(null)).toEqual(
      DEFAULT_TASK_PROPERTY_DISPLAY
    );
    expect(
      readTaskPropertyDisplay({ project: 'hide_when_empty', tags: 'bad' })
    ).toEqual({
      ...DEFAULT_TASK_PROPERTY_DISPLAY,
      project: 'hide_when_empty',
    });
  });
});
