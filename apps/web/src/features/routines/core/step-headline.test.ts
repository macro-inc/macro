import { describe, expect, it, vi } from 'vitest';
import { agentStep, choice, chooseStep, ifStep } from './routine-steps';
import {
  aiPicks,
  createActionStep,
  createPickStep,
  stepActions,
  triggerScope,
} from './step-catalog';
import { copyStep, wrapInIf } from './step-edits';
import { aiCallsPerRun, readableText, stepHeadline } from './step-headline';

vi.mock(
  '@property/identifiers',
  async () => await vi.importActual('@property/identifiers')
);

const email = triggerScope('email');
const action = (key: string) =>
  stepActions.find((action) => action.key === key)!;

describe('step headlines', () => {
  it('names the action, then what it is set to', () => {
    const label = createActionStep(action('add_label'), email);
    expect(
      stepHeadline({
        ...label,
        arguments: { ...label.arguments, label: 'Finance' },
      })
    ).toEqual({ title: 'Add label', summary: 'Finance' });
    const task = createActionStep(action('create_task'), email);
    expect(
      stepHeadline({
        ...task,
        arguments: {
          ...task.arguments,
          documentName: 'Pay: {{trigger.email.subject}}',
        },
      })
    ).toEqual({ title: 'Create task', summary: 'Pay: Email subject' });
    expect(stepHeadline(createActionStep(action('archive'), email))).toEqual({
      title: 'Archive',
      summary: '',
    });
  });

  it('reads a choice by its question and how it runs its options', () => {
    expect(
      stepHeadline(
        chooseStep('What kind of email is this?', [choice('A'), choice('B')])
      )
    ).toEqual({
      title: 'Choose',
      summary: 'What kind of email is this?',
      mode: 'Best match',
    });
    const priority = createPickStep(
      aiPicks.find((pick) => pick.action === 'set_priority')!,
      triggerScope('task')
    );
    // One priority applies, so it has no mode to name.
    expect(stepHeadline(priority)).toEqual({
      title: 'Set priority with AI',
      summary: 'Urgent · High · Medium · Low',
      mode: undefined,
    });
  });

  it('names fields and counts a run’s AI calls', () => {
    expect(
      readableText(
        'From {{trigger.email.from.name}}: {{steps.task.documentId}}'
      )
    ).toBe('From Sender name: task documentId');
    expect(aiCallsPerRun([createActionStep(action('archive'), email)])).toBe(0);
    expect(
      aiCallsPerRun([
        ifStep('Urgent?'),
        agentStep({ kind: 'model', model: 'm' }),
      ])
    ).toBe(2);
  });
});

describe('step edits', () => {
  it('copies a step with new ids and outputs its own references follow', () => {
    const task = createActionStep(action('create_task'), email);
    const priority = createActionStep(action('set_priority'), {
      ...email,
      items: [
        ...email.items,
        {
          ref: '{{steps.task.documentId}}',
          subject: 'task',
          label: 'New task',
        },
      ],
    });
    const decision = { ...ifStep('Due soon?'), yes: [task, priority] };
    const copy = copyStep(decision, [decision]);
    expect(copy.id).not.toBe(decision.id);
    expect(copy).toMatchObject({
      kind: 'if',
      yes: [
        { tool: 'CreateDocument', output: 'task_2' },
        { arguments: { entity_id: '{{steps.task_2.documentId}}' } },
      ],
    });
    expect(wrapInIf(task)).toMatchObject({ kind: 'if', yes: [task], no: [] });
  });
});
