import { describe, expect, it } from 'vitest';
import {
  freshTaskFromTemplate,
  templateSubmitKind,
} from './template-selection';

describe('template workflow', () => {
  it('requires a task title only when creating a task', () => {
    expect(templateSubmitKind({ kind: 'none' }, '')).toBe('task');
    expect(
      templateSubmitKind(
        { kind: 'new', name: 'Reusable', teamId: null, creationId: 'creation' },
        ''
      )
    ).toBe('template');
    expect(
      templateSubmitKind(
        {
          kind: 'new',
          name: 'Reusable',
          teamId: 'team',
          creationId: 'creation',
        },
        'Task'
      )
    ).toBe('task-and-template');
    expect(
      templateSubmitKind(
        {
          kind: 'editing',
          template: {
            id: 'saved',
            revision: 4,
            name: 'Old',
            teamId: null,
            contents: {
              propertyIds: [],
              propertyDefaults: {},
              descriptionMarkdown: '',
            },
          },
          name: 'Edited',
        },
        ''
      )
    ).toBe('template');
  });

  it('reinitializes Create More from the saved preset and retains contextual Source and Project', () => {
    const next = freshTaskFromTemplate(
      {
        propertyIds: ['source', 'project', 'assignee'],
        propertyDefaults: {
          source: { valueType: 'STRING', value: 'current document' },
          project: { valueType: 'STRING', value: 'current project' },
          assignee: { valueType: 'STRING', value: 'composer default' },
        },
        descriptionMarkdown: '',
      },
      {
        propertyIds: ['source', 'project', 'assignee', 'priority'],
        propertyDefaults: {
          source: { valueType: 'STRING', value: 'previous document' },
          project: { valueType: 'STRING', value: 'template project' },
          assignee: { valueType: 'STRING', value: 'template assignee' },
          priority: { valueType: 'NUMBER', value: 0 },
        },
        descriptionMarkdown: 'Reusable description',
      },
      new Set(['source', 'project', 'assignee', 'priority']),
      new Set(['source', 'project'])
    );
    expect(next.propertyDefaults).toEqual({
      source: { valueType: 'STRING', value: 'current document' },
      project: { valueType: 'STRING', value: 'current project' },
      assignee: { valueType: 'STRING', value: 'template assignee' },
      priority: { valueType: 'NUMBER', value: 0 },
    });
    expect(next.descriptionMarkdown).toBe('Reusable description');
  });
});

it('keeps contextual Due Date when resetting a task from a saved template', () => {
  const next = freshTaskFromTemplate(
    {
      propertyIds: ['due'],
      propertyDefaults: {
        due: { valueType: 'DATE', value: new Date('2026-10-22T00:00:00Z') },
      },
      descriptionMarkdown: '',
    },
    {
      propertyIds: ['due'],
      propertyDefaults: {
        due: { valueType: 'DATE', value: new Date('2025-10-22T00:00:00Z') },
      },
      descriptionMarkdown: 'Saved description',
    },
    new Set(['due']),
    new Set(['due'])
  );
  expect(next.propertyDefaults.due).toEqual({
    valueType: 'DATE',
    value: new Date('2026-10-22T00:00:00Z'),
  });
  expect(next.descriptionMarkdown).toBe('Saved description');
});
