import { describe, expect, it } from 'vitest';
import { freshTaskFromTemplate } from './template-selection';
import { isTemplateStateDirty } from './template-state';

describe('template replacement state', () => {
  it('replaces A with B from the original fields and preserves contextual empty values', () => {
    const original = {
      propertyIds: ['source', 'assignee'],
      propertyDefaults: {
        source: { valueType: 'ENTITY' as const, refs: null },
        assignee: { valueType: 'STRING' as const, value: 'launch assignee' },
      },
      descriptionMarkdown: '',
    };
    const available = new Set(['source', 'assignee', 'onlyA', 'onlyB']);
    const contextual = new Set(['source', 'assignee']);
    const a = freshTaskFromTemplate(
      original,
      {
        propertyIds: ['source', 'onlyA'],
        propertyDefaults: {
          source: {
            valueType: 'ENTITY',
            refs: [{ entity_id: 'old', entity_type: 'DOCUMENT' }],
          },
          onlyA: { valueType: 'STRING', value: 'A default' },
        },
        descriptionMarkdown: 'A description',
      },
      available,
      contextual
    );
    expect(a.propertyDefaults.source).toEqual(original.propertyDefaults.source);
    const b = freshTaskFromTemplate(
      original,
      {
        propertyIds: ['onlyB'],
        propertyDefaults: { onlyB: { valueType: 'NUMBER', value: 0 } },
        descriptionMarkdown: 'B description',
      },
      available,
      contextual,
      {
        source: { valueType: 'ENTITY', refs: [] },
        assignee: original.propertyDefaults.assignee,
      }
    );
    expect(b).toEqual({
      propertyIds: ['source', 'assignee', 'onlyB'],
      propertyDefaults: {
        ...original.propertyDefaults,
        source: { valueType: 'ENTITY', refs: [] },
        onlyB: { valueType: 'NUMBER', value: 0 },
      },
      descriptionMarkdown: 'B description',
    });
    expect(b.propertyIds).not.toContain('onlyA');
    expect(b.propertyDefaults).not.toHaveProperty('onlyA');
    expect(original.propertyIds).toEqual(['source', 'assignee']);
    expect(original.propertyDefaults).not.toHaveProperty('onlyA');
  });

  it('resets to the original fields without reverting current contextual values', () => {
    const original = {
      propertyIds: ['source', 'project'],
      propertyDefaults: {
        source: {
          valueType: 'ENTITY' as const,
          refs: [{ entity_id: 'origin', entity_type: 'DOCUMENT' as const }],
        },
        project: {
          valueType: 'ENTITY' as const,
          refs: [{ entity_id: 'launch', entity_type: 'INITIATIVE' as const }],
        },
      },
      descriptionMarkdown: '',
    };
    const reset = freshTaskFromTemplate(
      original,
      { propertyIds: [], propertyDefaults: {}, descriptionMarkdown: '' },
      new Set(['source', 'project', 'onlyA']),
      new Set(['source', 'project']),
      {
        source: { valueType: 'ENTITY', refs: [] },
        project: {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'current', entity_type: 'INITIATIVE' }],
        },
        onlyA: { valueType: 'NUMBER', value: 7 },
      }
    );
    expect(reset.propertyIds).toEqual(['source', 'project']);
    expect(reset.propertyDefaults.source).toEqual({
      valueType: 'ENTITY',
      refs: [],
    });
    expect(reset.propertyDefaults.project).toEqual({
      valueType: 'ENTITY',
      refs: [{ entity_id: 'current', entity_type: 'INITIATIVE' }],
    });
    expect(reset.propertyDefaults).not.toHaveProperty('onlyA');
    expect(reset.descriptionMarkdown).toBe('');
  });

  it('protects unsaved template names and visibility changes', () => {
    const baseline = {
      propertyIds: [],
      propertyDefaults: {},
      descriptionMarkdown: '',
    };
    const creating = {
      kind: 'new' as const,
      name: '',
      teamId: null,
      creationId: 'new-request',
    };
    expect(isTemplateStateDirty(baseline, baseline, creating)).toBe(false);
    expect(
      isTemplateStateDirty(baseline, baseline, { ...creating, name: 'Unsaved' })
    ).toBe(true);
    expect(
      isTemplateStateDirty(baseline, baseline, { ...creating, teamId: 'team' })
    ).toBe(true);
    const editing = {
      kind: 'editing' as const,
      name: 'Saved',
      template: {
        id: 'template',
        name: 'Saved',
        teamId: null,
        revision: 1,
        contents: baseline,
      },
    };
    expect(isTemplateStateDirty(baseline, baseline, editing)).toBe(false);
    expect(
      isTemplateStateDirty(baseline, baseline, { ...editing, name: 'Changed' })
    ).toBe(true);
  });

  it('requires consent before replacing prefilled task text but not untouched template text', () => {
    const initial = {
      propertyIds: [],
      propertyDefaults: {},
      descriptionMarkdown: 'Prefilled task text',
    };
    expect(isTemplateStateDirty(initial, initial, { kind: 'none' })).toBe(true);
    expect(
      isTemplateStateDirty(initial, initial, {
        kind: 'new',
        name: '',
        teamId: null,
        creationId: 'new-request',
      })
    ).toBe(true);
    const saved = {
      kind: 'saved' as const,
      template: {
        id: 'template',
        name: 'Saved',
        teamId: null,
        revision: 1,
        contents: initial,
      },
    };
    expect(isTemplateStateDirty(initial, initial, saved)).toBe(false);
    const restored = freshTaskFromTemplate(
      initial,
      { propertyIds: [], propertyDefaults: {}, descriptionMarkdown: '' },
      new Set(),
      new Set()
    );
    expect(restored.descriptionMarkdown).toBe('Prefilled task text');
  });

  it('tracks edits against the programmatic baseline without a title', () => {
    const baseline = {
      propertyIds: ['source', 'priority'],
      propertyDefaults: {
        source: { valueType: 'STRING' as const, value: 'current' },
        priority: { valueType: 'NUMBER' as const, value: 0 },
      },
      descriptionMarkdown: 'Template body',
    };
    expect(isTemplateStateDirty(structuredClone(baseline), baseline)).toBe(
      false
    );
    expect(isTemplateStateDirty(baseline, undefined)).toBe(true);
    expect(
      isTemplateStateDirty({ ...baseline, descriptionMarkdown: '' }, baseline)
    ).toBe(true);
    expect(
      isTemplateStateDirty({ ...baseline, propertyIds: ['source'] }, baseline)
    ).toBe(true);
    expect(
      isTemplateStateDirty(
        {
          ...baseline,
          propertyDefaults: {
            ...baseline.propertyDefaults,
            priority: { valueType: 'NUMBER', value: null },
          },
        },
        baseline
      )
    ).toBe(true);
    expect(
      isTemplateStateDirty(
        {
          ...baseline,
          propertyDefaults: { source: baseline.propertyDefaults.source },
        },
        baseline
      )
    ).toBe(true);
  });
});
