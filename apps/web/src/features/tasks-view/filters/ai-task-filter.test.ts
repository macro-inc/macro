import { describe, expect, it, vi } from 'vitest';
import {
  type AiTaskFilterCatalog,
  type AiTaskFilterReply,
  buildAiTaskFilterRequest,
  buildAiTaskFilterResponseFormat,
  parseAiTaskFilterResponse,
  resolveAiTaskFilterPlan,
} from './ai-task-filter';
import { TASK_VIEWER } from './task-facets';

const catalog: AiTaskFilterCatalog = {
  viewer: TASK_VIEWER,
  tags: [{ id: 'tag-design', label: 'Design' }],
};
const reply: AiTaskFilterReply = {
  status: ['in-progress'],
  priority: [],
  assignees: [],
  createdBy: [],
  tags: [],
  search: '',
  unresolved: '',
};

describe('task filter extraction', () => {
  it('requests strict JSON without a personal catalog or fixed viewer disclosure', () => {
    const request = buildAiTaskFilterRequest('  high priority  ', {
      ...catalog,
      viewer: 'macro|viewer@example.com',
    });
    expect(request.messages.at(-1)).toEqual({
      role: 'user',
      content: 'high priority',
    });
    expect(request.messages[0].content).not.toContain(
      'macro|viewer@example.com'
    );
    expect(request.messages[0].content).toContain(TASK_VIEWER);
    expect(buildAiTaskFilterResponseFormat().json_schema.strict).toBe(true);
    expect(parseAiTaskFilterResponse(JSON.stringify(reply))).toEqual(reply);
  });
  it('rejects malformed replies and invalid enums before resolving people', () => {
    for (const value of [
      undefined,
      'not json',
      '[]',
      '{}',
      JSON.stringify({ ...reply, status: ['archived'] }),
      JSON.stringify({ ...reply, extra: true }),
    ])
      expect(parseAiTaskFilterResponse(value)).toBeUndefined();
  });
});

describe('task filter resolution', () => {
  it('retains viewer semantics while literal identities stay fixed', () => {
    const person = vi.fn((label: string) =>
      label === 'viewer@example.com' ? 'macro|viewer@example.com' : undefined
    );
    const data = {
      ...reply,
      assignees: [TASK_VIEWER, 'viewer@example.com'],
      createdBy: [TASK_VIEWER],
    };
    expect(resolveAiTaskFilterPlan(data, catalog, person)).toEqual({
      ok: true,
      plan: {
        facets: {
          status: ['in-progress'],
          assignees: [TASK_VIEWER, 'macro|viewer@example.com'],
          'created-by': [TASK_VIEWER],
        },
        search: undefined,
        unresolved: undefined,
      },
    });
    const embedded = resolveAiTaskFilterPlan(
      data,
      { ...catalog, viewer: 'macro|viewer@example.com' },
      person
    );
    expect(embedded.ok && embedded.plan.facets.assignees).toEqual([
      'macro|viewer@example.com',
    ]);
    expect(person).not.toHaveBeenCalledWith(TASK_VIEWER);
  });
  it('does not apply other restrictions or free text when any person is unresolved', () => {
    const person = (label: string) =>
      label === 'Known' ? 'macro|known@example.com' : undefined;
    for (const data of [
      { ...reply, assignees: ['Known', 'Unknown'], search: 'billing' },
      {
        ...reply,
        assignees: ['Known'],
        createdBy: ['Ambiguous'],
        tags: ['tag-design'],
      },
    ])
      expect(resolveAiTaskFilterPlan(data, catalog, person)).toEqual({
        ok: false,
        error: 'UNRESOLVED_PEOPLE',
      });
  });
  it('preserves model name boundaries and existing status/tag/search behavior', () => {
    const person = vi.fn((label: string) =>
      label === 'Family, Given' ? 'macro|person@example.com' : undefined
    );
    const result = resolveAiTaskFilterPlan(
      {
        ...reply,
        status: ['in-progress', 'in-progress'],
        assignees: ['Family, Given', 'Family, Given'],
        priority: ['high'],
        tags: ['design', 'unknown'],
        search: '  billing ',
        unresolved: 'Some tags were unavailable.',
      },
      catalog,
      person
    );
    expect(result).toEqual({
      ok: true,
      plan: {
        facets: {
          status: ['in-progress'],
          assignees: ['macro|person@example.com'],
          priority: ['high'],
          tags: ['tag-design'],
        },
        search: 'billing',
        unresolved: 'Some tags were unavailable.',
      },
    });
    expect(person).toHaveBeenCalledWith('Family, Given');
    expect(person).not.toHaveBeenCalledWith('Family');
  });
  it('preserves an empty-plan explanation', () => {
    expect(
      resolveAiTaskFilterPlan(
        { ...reply, status: [], unresolved: 'Due date is unsupported.' },
        catalog,
        () => undefined
      )
    ).toEqual({
      ok: false,
      error: 'NO_FILTERS',
      unresolved: 'Due date is unsupported.',
    });
  });
});
