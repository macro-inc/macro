import { describe, expect, it, vi } from 'vitest';
import { stepsToWire } from './routine-steps';
import type { RoutineTriggerDraft } from './routine-triggers';
import {
  aiPicks,
  availableActions,
  availablePicks,
  blankPickOption,
  createActionStep,
  createPickStep,
  describeChoice,
  describeToolStep,
  pickAction,
  retarget,
  type StepSubject,
  scopeAfter,
  stepActionKey,
  stepActions,
  stepNeedsInput,
  stepTargets,
  summarizeStep,
  triggerScope,
  triggerSubject,
  validateStepSubjects,
  validateToolStep,
} from './step-catalog';

vi.mock(
  '@property/identifiers',
  async () => await vi.importActual('@property/identifiers')
);

const action = (key: string) =>
  stepActions.find((action) => action.key === key)!;

const event = (
  events: Extract<RoutineTriggerDraft, { kind: 'event' }>['events']
): RoutineTriggerDraft => ({ id: events.join(), kind: 'event', events });

describe('routine step catalog', () => {
  it('reads the subject only when every trigger agrees', () => {
    expect(triggerSubject([event(['email.message_received'])])).toBe('email');
    expect(
      triggerSubject([event(['task.created', 'task.status_changed'])])
    ).toBe('task');
    expect(
      triggerSubject([
        event(['task.created']),
        event(['email.message_received']),
      ])
    ).toBeUndefined();
    expect(triggerSubject([])).toBeUndefined();
  });

  it('offers subject actions only for matching triggers', () => {
    const keys = (subject: StepSubject | undefined) =>
      availableActions(triggerScope(subject)).map((action) => action.key);
    expect(keys('email')).toContain('archive');
    expect(keys('email')).not.toContain('set_status');
    expect(keys('task')).toContain('set_status');
    expect(keys(undefined)).toEqual([
      'create_task',
      'create_document',
      'send_message',
    ]);
  });

  it('acts on tasks that earlier steps created, even on a schedule', () => {
    const create = action('create_task');
    const first = createActionStep(create, triggerScope(undefined));
    const second = createActionStep(create, triggerScope(undefined), [first]);
    expect([first.output, second.output]).toEqual(['task', 'task_2']);
    const scope = scopeAfter(triggerScope(undefined), {
      ...first,
      arguments: { ...first.arguments, documentName: 'Standup' },
    });
    expect(availableActions(scope).map((action) => action.key)).toContain(
      'set_priority'
    );
    const priority = createActionStep(action('set_priority'), scope);
    expect(priority.arguments).toMatchObject({
      entity_id: '{{steps.task.documentId}}',
      entity_type: 'document',
    });
    expect(stepTargets(priority, scope).map((item) => item.label)).toEqual([
      'New task “Standup”',
    ]);
  });

  it('moves a step to another item in scope', () => {
    const email = triggerScope('email');
    const task = createActionStep(action('create_task'), email);
    const scope = scopeAfter(email, task);
    const tag = createActionStep(action('add_tag'), scope);
    expect(tag.arguments.entity_type).toBe('thread');
    const [, created] = stepTargets(tag, scope);
    expect(retarget(tag, created!).arguments).toMatchObject({
      entity_id: '{{steps.task.documentId}}',
      entity_type: 'document',
    });
  });

  it('recognizes every action it creates', () => {
    for (const action of stepActions) {
      const step = createActionStep(action, triggerScope(action.subjects?.[0]));
      expect(stepActionKey(step), action.key).toBe(action.key);
      expect(describeToolStep(step)).not.toBe('');
    }
  });

  it('labels and tags threads by name in the thread’s own inbox', () => {
    const archive = createActionStep(action('archive'), triggerScope('email'));
    expect(archive.arguments).toEqual({
      thread_id: '{{trigger.entity_id}}',
      label: 'INBOX',
      add: false,
    });
    const tag = createActionStep(action('add_tag'), triggerScope('email'));
    expect(tag.arguments.entity_type).toBe('thread');
  });

  it('requires the fields a person must fill in', () => {
    const create = (key: string) =>
      createActionStep(action(key), triggerScope('email'));
    expect(validateToolStep(create('add_label'))).toMatch(/label/);
    expect(validateToolStep(create('archive'))).toBeNull();
    // A target cleared on activation must be chosen before the step runs.
    const comment = create('comment');
    expect(
      validateToolStep({
        ...comment,
        arguments: { ...comment.arguments, entityId: '', content: 'Hi' },
      })
    ).toMatch(/acts on/);
    expect(validateToolStep(create('add_tag'))).toMatch(/tag/);
    expect(validateToolStep(create('send_message'))).toMatch(/channel/);
    expect(validateToolStep(create('create_task'))).toBeNull();
    const label = create('add_label');
    expect(
      validateToolStep({
        ...label,
        arguments: { ...label.arguments, label: 'Finance' },
      })
    ).toBeNull();
  });

  it('falls back to the tool name for raw tool calls', () => {
    const step = {
      id: 'x',
      kind: 'tool' as const,
      tool: 'SetEntityProperty' as const,
      arguments: { entity_id: '1', property_definition_id: 'due' },
    };
    expect(stepActionKey(step)).toBe('other');
    expect(describeToolStep(step)).toBe('Set Entity Property');
  });
});

describe('steps on the triggering item', () => {
  const event = (events: string[]): RoutineTriggerDraft =>
    ({ id: events[0], kind: 'event', events }) as RoutineTriggerDraft;
  const archive = createActionStep(
    stepActions.find((action) => action.key === 'archive')!,
    triggerScope('email')
  );

  it('needs every trigger to be for an item the step can act on', () => {
    expect(
      validateStepSubjects([archive], [event(['email.message_received'])])
    ).toBeNull();
    // The routine was switched to tasks: archiving one can't work.
    expect(validateStepSubjects([archive], [event(['task.created'])])).toMatch(
      /Archive.*an email/
    );
    // A task trigger added beside the email one would hand it a task.
    expect(
      validateStepSubjects(
        [archive],
        [event(['email.message_received']), event(['task.created'])]
      )
    ).toMatch(/every trigger/);
  });
});

describe('AI picks', () => {
  const pick = (key: string) => aiPicks.find((pick) => pick.action === key)!;

  it('offers picks for what is in scope', () => {
    const labels = (subject: StepSubject | undefined) =>
      availablePicks(triggerScope(subject)).map((pick) => pick.label);
    expect(labels('email')).toEqual(['Label with AI', 'Tag with AI']);
    expect(labels('task')).toEqual([
      'Tag with AI',
      'Set priority with AI',
      'Assign with AI',
    ]);
    expect(labels(undefined)).toEqual([]);
  });

  it('applies every fitting label as one choice of single steps', () => {
    const step = createPickStep(pick('add_label'), triggerScope('email'));
    expect(pickAction(step)).toBe('add_label');
    expect(describeChoice(step)).toBe('Label with AI');
    expect(step.multiple).toBe(true);
    const [wire] = stepsToWire([step]);
    expect(wire).toMatchObject({
      type: 'choose',
      multiple: true,
      question: 'Which labels fit this email?',
      options: [
        { label: '', steps: [{ type: 'tool', tool: 'UpdateThreadLabels' }] },
        { label: '', steps: [{ type: 'tool', tool: 'UpdateThreadLabels' }] },
      ],
    });
    const added = blankPickOption(step, 'add_label')!;
    expect(added.steps[0]).toMatchObject({ arguments: { label: '' } });
  });

  it('picks one priority from prefilled options', () => {
    const step = createPickStep(pick('set_priority'), triggerScope('task'));
    expect(step.multiple).toBe(false);
    expect(step.options.map((option) => option.label)).toEqual([
      'Urgent',
      'High',
      'Medium',
      'Low',
    ]);
    expect(pickAction(step)).toBe('set_priority');
    expect(describeChoice(step)).toBe('Set priority with AI');
  });

  it('keeps extra steps in a pick and treats other choices as plain', () => {
    const step = createPickStep(pick('set_priority'), triggerScope('task'));
    const [first, ...rest] = step.options;
    const comment = createActionStep(action('comment'), triggerScope('task'));
    const extra = {
      ...step,
      options: [{ ...first!, steps: [...first!.steps, comment] }, ...rest],
    };
    expect(pickAction(extra)).toBe('set_priority');
    const mixed = {
      ...step,
      options: [{ ...first!, steps: [comment] }, ...rest],
    };
    expect(pickAction(mixed)).toBeUndefined();
    expect(describeChoice(mixed)).toBe('Choose');
    expect(describeChoice({ ...mixed, multiple: true })).toBe(
      'Choose all that fit'
    );
  });

  it('summarizes collapsed steps and spots missing input', () => {
    const step = createPickStep(pick('set_priority'), triggerScope('task'));
    expect(summarizeStep(step)).toBe('Urgent · High · Medium · Low');
    expect(stepNeedsInput(step)).toBe(false);
    const labels = createPickStep(pick('add_label'), triggerScope('email'));
    expect(stepNeedsInput(labels)).toBe(true);
    const comment = createActionStep(action('comment'), triggerScope('task'));
    expect(stepNeedsInput(comment)).toBe(true);
    expect(
      summarizeStep({
        ...comment,
        arguments: { ...comment.arguments, content: 'Triaged' },
      })
    ).toBe('Triaged');
  });
});
