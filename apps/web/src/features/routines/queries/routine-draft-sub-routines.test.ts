import type {
  RoutineTask,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { describe, expect, it } from 'vitest';
import type { ScheduleDraft } from '../core/draft';
import {
  validateRoutineDraft,
  withDraftSteps,
  withNewDraftSteps,
} from '../core/routine-draft';
import {
  draftFromSchedule,
  draftToCreateBody,
  draftToUpdateBody,
  isUnchangedUpdate,
  routineTargetKind,
  scheduleToDuplicateBody,
} from './routine-draft';

import { cron, events, loadedDraft } from './routine-draft-test-support';

describe('routines with sub-routines', () => {
  const remind = {
    name: 'remind',
    title: 'Remind me',
    inputs: [{ type: 'text' as const, name: 'taskId', label: 'Task' }],
    steps: [
      {
        type: 'agent' as const,
        model: 'claude',
        instructions: 'Remind me about the task.',
      },
    ],
  };
  const parent: ScheduledAction = {
    ...events,
    task: {
      steps: [
        {
          type: 'code',
          title: 'Find tasks due soon',
          source: 'export async function main() {}',
        },
      ],
      sub_routines: [remind],
    },
  };
  const copy: ScheduledAction = {
    ...events,
    id: 'copy-id',
    trigger: { type: 'once', at: '2026-12-01T09:00:00Z' },
    task: { sub_routine: 'remind', inputs: { taskId: 'task-1' } },
    sub_routine: { parent_id: 'cron-id', created_by_run_id: 'run-1' },
  };

  it('reads an exact copy task without treating it as an agent', () => {
    const copy: ScheduledAction = {
      ...cron,
      task: { sub_routine: 'remind', inputs: { taskId: 'task-1' } },
      sub_routine: { parent_id: 'parent', created_by_run_id: 'run' },
    };
    expect(loadedDraft(copy).copy).toEqual({
      subRoutine: 'remind',
      inputs: { taskId: 'task-1' },
    });
    expect(routineTargetKind(copy)).toBeUndefined();
  });

  it('writes the stored task back while nothing changed', () => {
    const draft = draftFromSchedule(parent)!;
    expect(draft.subRoutines?.map((item) => item.title)).toEqual(['Remind me']);
    expect(validateRoutineDraft(draft)).toBeNull();
    const body = draftToUpdateBody(draft, parent)!;
    expect(body.task).toBe(parent.task);
    expect(isUnchangedUpdate(body, parent)).toBe(true);
  });

  it('keeps every sub-routine when the routine’s own steps change', () => {
    const draft = draftFromSchedule(parent)!;
    const edited = withDraftSteps(draft, [
      ...draft.steps!,
      {
        id: 'added',
        kind: 'agent',
        instructions: 'Summarize what was scheduled',
        target: { kind: 'model', model: 'claude' },
      },
    ]);
    // The scheduler refuses an update that leaves them out.
    expect(draftToUpdateBody(edited, parent)?.task).toMatchObject({
      sub_routines: [remind],
    });
  });

  it('saves an edit to a sub-routine’s steps with the routine', () => {
    const draft = draftFromSchedule(parent)!;
    const [definition] = draft.subRoutines!;
    const [step] = definition!.steps;
    const edited: ScheduleDraft = {
      ...draft,
      subRoutines: [
        {
          ...definition!,
          steps: [
            { ...step!, instructions: 'Remind me, and say when it is due.' },
          ] as typeof definition.steps,
        },
      ],
    };
    const task = draftToUpdateBody(edited, parent)?.task;
    expect(task).toEqual({
      steps: (parent.task as { steps: unknown }).steps,
      sub_routines: [
        {
          ...remind,
          mcp_servers: [],
          steps: [
            {
              type: 'agent',
              model: 'claude',
              instructions: 'Remind me, and say when it is due.',
            },
          ],
        },
      ],
    });
  });

  it('holds back a sub-routine whose steps can’t run, naming it', () => {
    const draft = draftFromSchedule(parent)!;
    const emptied = {
      ...draft,
      subRoutines: [{ ...draft.subRoutines![0]!, steps: [] }],
    };
    expect(validateRoutineDraft(emptied)).toBe(
      'In “Remind me”: Add a step to tell this routine what to do.'
    );
  });

  it('holds back a definition with apps after its last Ask AI step is removed', () => {
    const configured: ScheduledAction = {
      ...parent,
      task: {
        steps: [{ type: 'agent', model: 'model', instructions: 'Plan' }],
        sub_routines: [
          {
            ...remind,
            mcp_servers: [{ app_slug: 'example', server_name: 'Example' }],
            steps: [
              {
                type: 'code',
                title: 'Remind',
                source: 'export function main() {}',
              },
            ],
          },
        ],
      },
    };
    const draft = loadedDraft(configured);
    expect(validateRoutineDraft(draft)).toBe(
      'In “Remind me”: Apps are for an Ask AI step. Add one, or remove the apps.'
    );
  });

  it('enforces the combined code-step budget including a detached copy', () => {
    const steps = Array.from({ length: 20 }, (_, index) => ({
      type: 'code' as const,
      title: `Read ${index + 1}`,
      source: 'export const result = 1;',
    }));
    const configured = {
      ...parent,
      task: {
        steps: remind.steps,
        sub_routines: [{ ...remind, steps }],
      },
    };
    expect(validateRoutineDraft(loadedDraft(configured))).toBeNull();
    const tooMany = {
      ...configured,
      task: {
        ...configured.task,
        sub_routines: [
          {
            ...remind,
            steps: [
              ...steps,
              {
                type: 'code' as const,
                title: 'Another',
                source: 'export const result = 1;',
              },
            ],
          },
        ],
      },
    };
    expect(validateRoutineDraft(loadedDraft(tooMany))).toMatch(/40 code steps/);
  });

  it('keeps a single agent step as a program while it has sub-routines', () => {
    const draft = draftFromSchedule(parent)!;
    const agentOnly = withDraftSteps(draft, [
      {
        id: 'only',
        kind: 'agent',
        instructions: 'Look for tasks due soon',
        target: { kind: 'model', model: 'claude' },
      },
    ]);
    expect(draftToCreateBody(agentOnly).task).toMatchObject({
      steps: [{ type: 'agent', instructions: 'Look for tasks due soon' }],
      sub_routines: [remind],
    });
  });

  it.each(['sub_routines', 'inputs'] as const)(
    'creates and reloads a new routine with %s after editing its lone Ask AI step',
    (field) => {
      const task = {
        steps: remind.steps,
        [field]:
          field === 'sub_routines'
            ? [remind]
            : [
                {
                  type: 'text' as const,
                  name: 'taskId',
                  label: 'Task',
                  value: 'task-1',
                },
              ],
      };
      const initial = loadedDraft({ ...events, task });
      const edited = withNewDraftSteps(initial, [
        {
          id: 'only',
          kind: 'agent',
          instructions: 'Remind me now',
          target: { kind: 'model', model: 'claude' },
        },
      ]);

      const created = draftToCreateBody(edited);
      expect(created.task).toMatchObject({
        steps: [{ type: 'agent', instructions: 'Remind me now' }],
        [field]: task[field],
      });
      const reopened = loadedDraft({ ...events, task: created.task });
      expect(reopened.subRoutines?.map(({ name }) => name)).toEqual(
        initial.subRoutines?.map(({ name }) => name)
      );
      expect(reopened.inputs).toEqual(initial.inputs);
    }
  );

  it('keeps the values a kept routine’s code reads', () => {
    const inputs = [
      { type: 'text' as const, name: 'taskId', label: 'Task', value: 'task-1' },
    ];
    const kept: ScheduledAction = {
      ...events,
      task: { steps: remind.steps, inputs },
    };
    const draft = draftFromSchedule(kept)!;
    expect(draft.inputs).toEqual(inputs);
    const edited = withDraftSteps(draft, [
      { ...draft.steps![0]!, instructions: 'Remind me now' } as never,
    ]);
    expect(draftToUpdateBody(edited, kept)?.task).toMatchObject({ inputs });
  });

  it('edits only a copy’s trigger and settings, keeping its task', () => {
    const draft = draftFromSchedule(copy)!;
    expect(draft.copy).toEqual({
      subRoutine: 'remind',
      inputs: { taskId: 'task-1' },
    });
    // Its steps are its parent's, checked there.
    expect(validateRoutineDraft(draft)).toBeNull();
    const body = draftToUpdateBody(
      { ...draft, runVisibility: 'listed' },
      copy
    )!;
    expect(body.task).toBe(copy.task);
    expect(body.run_visibility).toBe('listed');
  });

  it('does not turn a scheduled copy into an ordinary create request', () => {
    expect(scheduleToDuplicateBody(copy)).toBeUndefined();
  });

  it('leaves a routine whose sub-routine it can’t show read-only', () => {
    const unshown: ScheduledAction = {
      ...parent,
      task: {
        ...(parent.task as object),
        sub_routines: [
          {
            ...remind,
            // An agent step with neither a model nor an agent.
            steps: [{ type: 'agent', instructions: 'Remind me' }],
          },
        ],
      } as RoutineTask,
    };
    expect(draftFromSchedule(unshown)).toBeUndefined();
  });

  it('leaves a routine read-only when a definition returns a future step type', () => {
    const task: RoutineTask = JSON.parse(
      JSON.stringify({
        ...parent.task,
        sub_routines: [{ ...remind, steps: [{ type: 'future' }] }],
      })
    );
    const newer = { ...parent, task };

    expect(draftFromSchedule(newer)).toBeUndefined();
    expect(draftToUpdateBody(loadedDraft(parent), newer)).toBeUndefined();
  });
});
