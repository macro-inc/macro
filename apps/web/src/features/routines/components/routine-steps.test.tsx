import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentStep, type StepDraft } from '../core/routine-steps';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import {
  aiPicks,
  createActionStep,
  createPickStep,
  stepActions,
  triggerScope,
} from '../core/step-catalog';
import { RoutineSteps } from './routine-step-editor';
import type { RoutineRunView, RoutineStepSlots } from './routine-steps';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

const email: RoutineTriggerDraft = {
  id: 'email',
  kind: 'event',
  events: ['email.message_received'],
};
const daily: RoutineTriggerDraft = {
  id: 'daily',
  kind: 'schedule',
  frequency: 'day',
  time: '09:00',
  daysOfWeek: [],
  dayOfMonth: '1',
  timezone: 'UTC',
  onceAt: '',
  cron: '0 0 9 * * *',
};

const slots: RoutineStepSlots = {
  PromptEditor: (props): JSX.Element => (
    <textarea
      aria-label="Instructions"
      value={props.initialValue}
      onInput={(event) => props.onChange(event.currentTarget.value)}
    />
  ),
  ExecutionPicker: () => <span>Model</span>,
  LabelPicker: (props) => (
    <input
      aria-label="Label"
      value={props.value}
      onInput={(event) => props.onChange(event.currentTarget.value)}
    />
  ),
  TagPicker: () => null,
  ChannelPicker: () => null,
  AssigneePicker: () => null,
  FolderPicker: () => null,
};

function renderSteps(options: {
  triggers: RoutineTriggerDraft[];
  decisions?: boolean;
  steps?: StepDraft[];
  lastRun?: RoutineRunView;
}) {
  const [steps, setSteps] = createSignal<StepDraft[]>(
    options.steps ?? [agentStep({ kind: 'model', model: 'm' }, 'Summarize')]
  );
  render(() => (
    <RoutineSteps
      steps={steps()}
      onChange={setSteps}
      triggers={options.triggers}
      defaultTarget={{ kind: 'model', model: 'm' }}
      decisionsEnabled={options.decisions ?? true}
      slots={slots}
      lastRun={options.lastRun}
    />
  ));
  return steps;
}

function openMenu(name: string, index = 0) {
  // A just-closed menu can leave the rest of the page aria-hidden briefly.
  const trigger = screen.getAllByRole('button', { name, hidden: true })[index]!;
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

function choose(name: string) {
  fireEvent.keyDown(screen.getByRole('menuitem', { name }), { key: 'Enter' });
}

afterEach(() => {
  cleanup();
  // The list or flow choice is remembered per viewer.
  localStorage.clear();
});

describe('routine steps editor', () => {
  it('adds email actions after the agent and edits their label', () => {
    const steps = renderSteps({ triggers: [email] });
    openMenu('Add step');
    choose('Archive');
    expect(steps().map((step) => step.kind)).toEqual(['agent', 'tool']);
    expect(steps()[1]).toMatchObject({
      tool: 'UpdateThreadLabels',
      arguments: { label: 'INBOX', add: false },
    });
    openMenu('Add step');
    choose('Add label');
    fireEvent.input(screen.getByLabelText('Label', { selector: 'input' }), {
      target: { value: 'Finance' },
    });
    expect(steps()[2]).toMatchObject({
      arguments: { label: 'Finance', add: true },
    });
    expect(
      screen.getByRole('region', { name: 'Archive', hidden: true })
    ).toBeTruthy();
  });

  it('branches on a yes/no question and adds steps inside a branch', () => {
    const steps = renderSteps({ triggers: [email], steps: [] });
    openMenu('Add step');
    choose('If yes or no');
    fireEvent.input(screen.getByLabelText('Yes/no question'), {
      target: { value: 'Is this an invoice?' },
    });
    openMenu('Add step to branch', 0);
    choose('Star');
    expect(steps()).toMatchObject([
      {
        kind: 'if',
        condition: 'Is this an invoice?',
        yes: [{ tool: 'UpdateThreadLabels', arguments: { label: 'STARRED' } }],
        no: [],
      },
    ]);
  });

  it('explains why schedules can’t decide or act on a triggering item', () => {
    renderSteps({ triggers: [daily] });
    openMenu('Add step');
    expect(screen.queryByRole('menuitem', { name: 'If yes or no' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    expect(screen.getByText(/Needs an activity trigger/)).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Create task' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Ask AI' })).toBeTruthy();
  });

  it('acts on a task created by an earlier step', () => {
    const steps = renderSteps({ triggers: [daily], steps: [] });
    openMenu('Add step');
    choose('Create task');
    openMenu('Add step');
    choose('Set priority');
    expect(steps()[1]).toMatchObject({
      tool: 'SetEntityProperty',
      arguments: { entity_id: '{{steps.task.documentId}}' },
    });
    expect(
      screen.getByRole('button', { name: 'Item', hidden: true })
    ).toBeTruthy();
  });

  it('lets AI apply every label that fits', () => {
    const steps = renderSteps({ triggers: [email], steps: [] });
    openMenu('Add step');
    choose('Label with AI');
    const [first, second] = screen.getAllByLabelText('Label', {
      selector: 'input',
    });
    fireEvent.input(first!, { target: { value: 'Finance' } });
    fireEvent.input(second!, { target: { value: 'Hiring' } });
    fireEvent.input(screen.getAllByLabelText('When it fits')[0]!, {
      target: { value: 'Invoices and receipts' },
    });
    expect(steps()).toMatchObject([
      {
        kind: 'choose',
        multiple: true,
        options: [
          {
            label: 'Finance',
            description: 'Invoices and receipts',
            steps: [{ arguments: { label: 'Finance', add: true } }],
          },
          { label: 'Hiring', steps: [{ arguments: { label: 'Hiring' } }] },
        ],
      },
    ]);
    expect(
      screen.getByRole('region', { name: 'Label with AI', hidden: true })
    ).toBeTruthy();
    // A row can also do more when its value fits.
    openMenu('Add step to branch', 0);
    choose('Archive');
    expect(steps()[0]).toMatchObject({
      options: [
        {
          label: 'Finance',
          steps: [
            { arguments: { label: 'Finance', add: true } },
            { arguments: { label: 'INBOX', add: false } },
          ],
        },
        { label: 'Hiring' },
      ],
    });
    expect(screen.getByText('Also')).toBeTruthy();
  });

  it('collapses finished steps and shows what the last run did', () => {
    const task = triggerScope('task');
    const priority = createPickStep(
      aiPicks.find((pick) => pick.action === 'set_priority')!,
      task
    );
    const comment = createActionStep(
      stepActions.find((action) => action.key === 'comment')!,
      task
    );
    renderSteps({
      triggers: [{ id: 'task', kind: 'event', events: ['task.created'] }],
      steps: [
        priority,
        { ...comment, arguments: { ...comment.arguments, content: 'Triaged' } },
      ],
      lastRun: {
        endedAt: '2026-10-09T10:55:33Z',
        success: true,
        steps: [
          { path: '0', kind: 'choose', choices: ['High'], probability: 0.96 },
          { path: '0.options.1.0', kind: 'tool', tool: 'SetEntityProperty' },
        ],
      },
    });
    expect(screen.getByText('Urgent · High · Medium · Low')).toBeTruthy();
    expect(screen.getByText('Triaged')).toBeTruthy();
    expect(screen.getByText('Chose High · 96%')).toBeTruthy();
    expect(screen.getByText('Didn’t run')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: /Set priority with AI/, hidden: true })
    );
    expect(screen.getAllByLabelText('Chosen').length).toBe(1);
  });

  it('shows decisions as a flow whose steps edit in place', () => {
    const labels = createPickStep(
      aiPicks.find((pick) => pick.action === 'add_label')!,
      triggerScope('email')
    );
    const named = {
      ...labels,
      options: labels.options.map((option, index) => {
        const name = ['Finance', 'Hiring'][index]!;
        const [step] = option.steps;
        return {
          ...option,
          label: name,
          steps: [
            {
              ...step!,
              arguments: {
                ...(step as { arguments: Record<string, unknown> }).arguments,
                label: name,
              },
            },
          ],
        };
      }),
    } as StepDraft;
    const steps = renderSteps({ triggers: [email], steps: [named] });
    fireEvent.click(screen.getByRole('radio', { name: 'Flow' }));
    expect(screen.getByText('Finance')).toBeTruthy();
    expect(screen.getByText('Hiring')).toBeTruthy();
    expect(screen.getByText('Nothing fits')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add label “Hiring”' }));
    fireEvent.input(screen.getByLabelText('Label', { selector: 'input' }), {
      target: { value: 'Recruiting' },
    });
    expect(steps()[0]).toMatchObject({
      options: [
        { label: 'Finance' },
        { steps: [{ arguments: { label: 'Recruiting' } }] },
      ],
    });

    openMenu('Add step to branch', 0);
    choose('Archive');
    expect(steps()[0]).toMatchObject({
      options: [
        {
          steps: [
            { arguments: { label: 'Finance' } },
            { arguments: { label: 'INBOX', add: false } },
          ],
        },
        {},
      ],
    });
  });

  it('reorders and removes steps from each step’s menu', () => {
    const steps = renderSteps({ triggers: [email] });
    openMenu('Add step');
    choose('Star');
    openMenu('Step actions', 1);
    choose('Move up');
    expect(steps().map((step) => step.kind)).toEqual(['tool', 'agent']);
    openMenu('Step actions', 0);
    choose('Remove step');
    expect(steps().map((step) => step.kind)).toEqual(['agent']);
  });
});
