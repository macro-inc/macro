import { describe, expect, it } from 'vitest';
import {
  captureTaskTemplate,
  fillTaskTemplate,
  type TaskTemplateContents,
} from './template';

describe('fillTaskTemplate', () => {
  it('fills missing fields while preserving text, context, zero, and false', () => {
    const current: TaskTemplateContents = {
      propertyIds: ['source', 'project', 'number', 'boolean'],
      propertyDefaults: {
        source: {
          valueType: 'ENTITY',
          refs: [
            {
              entity_id: 'channel',
              entity_type: 'CHANNEL',
              specific_message_id: 'reply',
            },
          ],
        },
        project: { valueType: 'ENTITY', refs: [] },
        number: { valueType: 'NUMBER', value: 0 },
        boolean: { valueType: 'BOOLEAN', value: false },
      },
      descriptionMarkdown: 'Existing description',
    };
    const template: TaskTemplateContents = {
      propertyIds: [
        'source',
        'project',
        'number',
        'boolean',
        'empty',
        'missing',
      ],
      propertyDefaults: {
        source: {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'other-channel', entity_type: 'CHANNEL' }],
        },
        project: {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'project', entity_type: 'INITIATIVE' }],
        },
        number: { valueType: 'NUMBER', value: 10 },
        boolean: { valueType: 'BOOLEAN', value: true },
        missing: { valueType: 'STRING', value: 'Unavailable' },
      },
      descriptionMarkdown: '- [ ] Template checklist',
    };
    const available = new Set([
      'source',
      'project',
      'number',
      'boolean',
      'empty',
    ]);
    const result = fillTaskTemplate(current, template, available);
    expect(result.propertyIds).toEqual([
      'source',
      'project',
      'number',
      'boolean',
      'empty',
    ]);
    expect(result.descriptionMarkdown).toBe('Existing description');
    expect(result.propertyDefaults.source).toEqual(
      current.propertyDefaults.source
    );
    expect(result.propertyDefaults.number).toEqual({
      valueType: 'NUMBER',
      value: 0,
    });
    expect(result.propertyDefaults.boolean).toEqual({
      valueType: 'BOOLEAN',
      value: false,
    });
    expect(result.propertyDefaults.project).toEqual(
      template.propertyDefaults.project
    );
    expect(result.propertyDefaults).not.toHaveProperty('missing');
    expect(fillTaskTemplate(result, template, available)).toEqual(result);
    expect(current.propertyDefaults.project).toEqual({
      valueType: 'ENTITY',
      refs: [],
    });
  });

  it('initializes blank description text and clones date defaults', () => {
    const due = new Date('2030-01-02T12:00:00Z');
    const template: TaskTemplateContents = {
      propertyIds: ['due'],
      propertyDefaults: { due: { valueType: 'DATE', value: due } },
      descriptionMarkdown: '## Details\n\n- [ ] Describe the task',
    };
    const result = fillTaskTemplate(
      {
        propertyIds: [],
        propertyDefaults: {},
        descriptionMarkdown: '  ',
      },
      template,
      new Set(['due'])
    );
    expect(result.descriptionMarkdown).toBe(template.descriptionMarkdown);
    expect(result.propertyDefaults.due).toEqual({
      valueType: 'DATE',
      value: due,
    });
    due.setUTCFullYear(2040);
    expect(result.propertyDefaults.due).toEqual({
      valueType: 'DATE',
      value: new Date('2030-01-02T12:00:00Z'),
    });
  });
});

describe('captureTaskTemplate', () => {
  it('keeps blank fields but excludes hidden, unavailable, and contextual defaults', () => {
    const current: TaskTemplateContents = {
      propertyIds: ['source', 'blank', 'selected', 'unavailable', 'selected'],
      propertyDefaults: {
        source: {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'channel', entity_type: 'CHANNEL' }],
        },
        blank: { valueType: 'STRING', value: '' },
        selected: { valueType: 'NUMBER', value: 0 },
        hidden: { valueType: 'STRING', value: 'Hidden value' },
        unavailable: { valueType: 'STRING', value: 'Unavailable value' },
      },
      descriptionMarkdown: '## Description',
    };
    expect(
      captureTaskTemplate(
        current,
        new Set(['source', 'blank', 'selected', 'hidden']),
        new Set(['source'])
      )
    ).toEqual({
      propertyIds: ['source', 'blank', 'selected'],
      propertyDefaults: { selected: { valueType: 'NUMBER', value: 0 } },
      descriptionMarkdown: '## Description',
    });
  });
});
