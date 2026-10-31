import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentStep,
  choice,
  chooseStep,
  type StepDraft,
} from '../core/routine-steps';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import {
  aiPicks,
  createActionStep,
  createPickStep,
  stepActions,
  triggerScope,
} from '../core/step-catalog';
import { RoutineSteps, RoutineStepsSummary } from './routine-step-editor';
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
  // Choose a folder, or clear it as the real picker does with an empty pick.
  FolderPicker: (props) => (
    <>
      <button type="button" onClick={() => props.onChange('folder-1')}>
        Pick folder
      </button>
      <button type="button" onClick={() => props.onChange(undefined)}>
        Clear folder
      </button>
    </>
  ),
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
  const [showRun, setShowRun] = createSignal(true);
  // As on the routine's page: the summary on the heading, then the steps.
  render(() => (
    <>
      <RoutineStepsSummary
        steps={steps()}
        triggers={options.triggers}
        lastRun={options.lastRun}
        showRun={showRun()}
        onShowRun={setShowRun}
      />
      <RoutineSteps
        steps={steps()}
        onChange={setSteps}
        triggers={options.triggers}
        defaultTarget={{ kind: 'model', model: 'm' }}
        decisionsEnabled={options.decisions ?? true}
        slots={slots}
        lastRun={options.lastRun}
        showRun={showRun()}
      />
    </>
  ));
  return steps;
}

function openAdd(name = 'Add step', index = 0) {
  // A just-closed menu can leave the rest of the page aria-hidden briefly.
  fireEvent.click(
    screen.getAllByRole('button', { name, hidden: true })[index]!
  );
}

/** Choose from the menu opened last; jsdom keeps closed popovers around. */
function add(name: string) {
  fireEvent.click(
    lastMenu().getByRole('option', {
      name: new RegExp(`^${name}`),
      hidden: true,
    })
  );
}

function lastMenu() {
  return within(screen.getAllByRole('listbox', { hidden: true }).at(-1)!);
}

function openMenu(name: string, index = 0) {
  const trigger = screen.getAllByRole('button', { name, hidden: true })[index]!;
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

function choose(name: string) {
  fireEvent.keyDown(
    screen.getByRole('menuitem', { name: new RegExp(`^${name}`) }),
    {
      key: 'Enter',
    }
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('routine steps editor', () => {
  it('adds email actions after the agent and edits their label', () => {
    const steps = renderSteps({ triggers: [email] });
    openAdd();
    add('Archive');
    expect(steps().map((step) => step.kind)).toEqual(['agent', 'tool']);
    expect(steps()[1]).toMatchObject({
      tool: 'UpdateThreadLabels',
      arguments: { label: 'INBOX', add: false },
    });
    openAdd();
    add('Add label');
    fireEvent.input(screen.getByLabelText('Label', { selector: 'input' }), {
      target: { value: 'Finance' },
    });
    expect(steps()[2]).toMatchObject({
      arguments: { label: 'Finance', add: true },
    });
    expect(
      screen.getByRole('group', { name: 'Archive', hidden: true })
    ).toBeTruthy();
  });

  it('finds steps by searching the Add step menu', () => {
    renderSteps({ triggers: [email] });
    openAdd();
    fireEvent.input(screen.getByRole('textbox', { name: 'Search steps' }), {
      target: { value: 'sender' },
    });
    expect(
      lastMenu().getByRole('option', { name: /^Mark sender as/ })
    ).toBeTruthy();
    expect(lastMenu().queryByRole('option', { name: /^Archive/ })).toBeNull();
  });

  it('branches on a yes/no question and adds steps inside a branch', () => {
    const steps = renderSteps({ triggers: [email], steps: [] });
    openAdd();
    add('If yes or no');
    fireEvent.input(screen.getByLabelText('Yes/no question'), {
      target: { value: 'Is this an invoice?' },
    });
    openAdd('Add step to “Yes”');
    add('Star');
    expect(steps()).toMatchObject([
      {
        kind: 'if',
        condition: 'Is this an invoice?',
        yes: [{ tool: 'UpdateThreadLabels', arguments: { label: 'STARRED' } }],
        no: [],
      },
    ]);
    // Numbered in reading order, through the branch.
    expect(
      screen.getByRole('group', { name: 'Star', hidden: true }).textContent
    ).toContain('2');
  });

  it('shows a choice’s options as branches with their steps', () => {
    const archive = createActionStep(
      stepActions.find((action) => action.key === 'archive')!,
      triggerScope('email')
    );
    const invoice = { ...choice('Invoice'), description: 'bills', steps: [] };
    const newsletter = { ...choice('Newsletter'), steps: [archive] };
    renderSteps({
      triggers: [email],
      steps: [chooseStep('What kind of email is this?', [invoice, newsletter])],
      lastRun: {
        success: true,
        steps: [
          {
            path: '0',
            kind: 'choose',
            choices: ['Newsletter'],
            probability: 0.9,
          },
          { path: '0.options.1.0', kind: 'tool', tool: 'UpdateThreadLabels' },
        ],
      },
    });
    expect(screen.getByText('What kind of email is this?')).toBeTruthy();
    expect(screen.getByText('Newsletter 90%')).toBeTruthy();
    expect(screen.getByText('· bills')).toBeTruthy();
    expect(screen.getAllByText('Do nothing').length).toBe(2);
    expect(
      screen.getByRole('group', { name: 'Archive', hidden: true })
    ).toBeTruthy();
  });

  it('explains why schedules can’t decide or act on a triggering item', () => {
    renderSteps({ triggers: [daily] });
    openAdd();
    expect(
      lastMenu().queryByRole('option', { name: /^If yes or no/ })
    ).toBeNull();
    expect(lastMenu().queryByRole('option', { name: /^Archive/ })).toBeNull();
    expect(screen.getByText(/need an activity trigger/)).toBeTruthy();
    expect(
      lastMenu().getByRole('option', { name: /^Create task/ })
    ).toBeTruthy();
    expect(lastMenu().getByRole('option', { name: /^Ask AI/ })).toBeTruthy();
  });

  it('files a created task in a folder and back in none', () => {
    const steps = renderSteps({ triggers: [daily], steps: [] });
    openAdd();
    add('Create task');
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick folder', hidden: true })
    );
    expect(steps()[0]?.kind === 'tool' && steps()[0]).toMatchObject({
      arguments: { projectId: 'folder-1' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear folder', hidden: true })
    );
    const created = steps()[0];
    expect(created?.kind === 'tool' && 'projectId' in created.arguments).toBe(
      false
    );
  });

  it('acts on a task created by an earlier step', () => {
    const steps = renderSteps({ triggers: [daily], steps: [] });
    openAdd();
    add('Create task');
    openAdd();
    add('Set priority');
    expect(steps()[1]).toMatchObject({
      tool: 'SetEntityProperty',
      arguments: { entity_id: '{{steps.task.documentId}}' },
    });
    expect(
      screen.getByRole('button', { name: 'Item', hidden: true })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'High', hidden: true }));
    expect(steps()[1]).toMatchObject({
      arguments: { option_id: '00000001-0000-0000-0003-000000000003' },
    });
  });

  it('writes text with fields from the triggering email', () => {
    const steps = renderSteps({ triggers: [email], steps: [] });
    openAdd();
    add('Create task');
    const title = screen.getByRole('textbox', { name: 'Title', hidden: true });
    title.textContent = 'Pay: ';
    fireEvent.input(title);
    openMenu('Insert a field');
    choose('Email subject');
    expect(steps()[0]).toMatchObject({
      arguments: { documentName: 'Pay: {{trigger.email.subject}}' },
    });
    expect(title.textContent).toContain('Email subject');
  });

  it('lets AI apply every label that fits', () => {
    const steps = renderSteps({ triggers: [email], steps: [] });
    openAdd();
    add('Label with AI');
    const [first, second] = screen.getAllByLabelText('Label', {
      selector: 'input',
    });
    fireEvent.input(first!, { target: { value: 'Finance' } });
    fireEvent.input(second!, { target: { value: 'Hiring' } });
    fireEvent.input(screen.getByLabelText('When option 1 fits'), {
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
      screen.getByRole('group', { name: 'Label with AI', hidden: true })
    ).toBeTruthy();
    // A row can also do more when its value fits.
    openAdd('Add step to “Finance”');
    add('Archive');
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
    expect(screen.getByText('Finance also')).toBeTruthy();
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
    expect(screen.getByText('High 96%')).toBeTruthy();
    // The comment didn't run, so it shows no result.
    expect(screen.queryAllByLabelText('Ran').length).toBe(0);
    fireEvent.click(screen.getByRole('switch', { name: 'Show last run' }));
    expect(screen.queryByText('High 96%')).toBeNull();
  });

  it('reorders, duplicates, wraps and deletes steps from each step’s menu', () => {
    const steps = renderSteps({ triggers: [email] });
    openAdd();
    add('Create task');
    openMenu('Step actions', 1);
    choose('Move up');
    expect(steps().map((step) => step.kind)).toEqual(['tool', 'agent']);
    openMenu('Step actions', 0);
    choose('Duplicate');
    expect(steps()).toMatchObject([
      { kind: 'tool', output: 'task' },
      { kind: 'tool', output: 'task_2' },
      { kind: 'agent' },
    ]);
    openMenu('Step actions', 1);
    choose('Wrap in');
    expect(steps()[1]).toMatchObject({
      kind: 'if',
      yes: [{ kind: 'tool', output: 'task_2' }],
    });
    openMenu('Step actions', 0);
    choose('Delete step');
    expect(steps().map((step) => step.kind)).toEqual(['if', 'agent']);
  });

  it('moves a step with ⌥↑, keeping focus, but leaves text fields their keys', async () => {
    const steps = renderSteps({ triggers: [email] });
    openAdd();
    add('Create task');
    const header = () =>
      screen.getByRole('button', { name: /^2.*Create task/, hidden: true });
    // ⌥↑ in a field of the card is the field's own navigation.
    const title = within(
      screen.getByRole('group', { name: 'Create task', hidden: true })
    ).getAllByRole('textbox', { hidden: true })[0]!;
    fireEvent.keyDown(title, { key: 'ArrowUp', altKey: true });
    expect(steps().map((step) => step.kind)).toEqual(['agent', 'tool']);
    const moving = header();
    moving.focus();
    fireEvent.keyDown(moving, { key: 'ArrowUp', altKey: true });
    expect(steps().map((step) => step.kind)).toEqual(['tool', 'agent']);
    await waitFor(() =>
      expect(document.activeElement?.textContent).toMatch(/^1.*Create task/)
    );
  });
});
