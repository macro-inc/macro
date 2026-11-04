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
import type { StepAuthor } from '../context/routine-slots';
import {
  agentStep,
  type CodeStepDraft,
  type StepDraft,
} from '../core/routine-steps';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import { RoutineSteps, RoutineStepsSummary } from './routine-step-editor';
import type { RoutineStepSlots } from './routine-steps';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

const email: RoutineTriggerDraft = {
  id: 'email',
  kind: 'event',
  events: ['email.message_received'],
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
};

function renderSteps(options: {
  triggers: RoutineTriggerDraft[];
  steps?: StepDraft[];
  author?: StepAuthor;
}) {
  const [steps, setSteps] = createSignal<StepDraft[]>(
    options.steps ?? [agentStep({ kind: 'model', model: 'm' }, 'Summarize')]
  );
  // As on the routine's page: the summary on the heading, then the steps.
  render(() => (
    <>
      <RoutineStepsSummary steps={steps()} triggers={options.triggers} />
      <RoutineSteps
        steps={steps()}
        onChange={setSteps}
        triggers={options.triggers}
        defaultTarget={{ kind: 'model', model: 'm' }}
        slots={
          options.author
            ? { ...slots, createStepAuthor: () => options.author! }
            : slots
        }
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

/** The box Edit opens; the menu it closed can leave the page aria-hidden briefly. */
function changeBox() {
  return screen.getByRole('textbox', {
    name: 'Change this step',
    hidden: true,
  });
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

const codeStep = (title: string, output?: string): CodeStepDraft => ({
  id: crypto.randomUUID(),
  kind: 'code',
  ...(output ? { output } : {}),
  title,
  summary: `${title}, as AI wrote it.`,
  source: 'export async function main() {}',
  knobs: [],
});

describe('routine steps editor', () => {
  it('adds an Ask AI step, and explains that AI writes code steps', () => {
    const steps = renderSteps({
      triggers: [email],
      steps: [codeStep('Label invoices')],
    });
    openAdd();
    expect(screen.getByText(/^Code steps are written by AI/)).toBeTruthy();
    add('Ask AI');
    expect(steps().map((step) => step.kind)).toEqual(['code', 'agent']);
    // A routine hands off to AI once.
    openAdd();
    expect(
      screen.getByText(/^This routine already has its Ask AI step/)
    ).toBeTruthy();
  });

  it('collapses finished steps, with what a run costs on the heading', () => {
    renderSteps({
      triggers: [{ id: 'task', kind: 'event', events: ['task.created'] }],
      steps: [
        codeStep('Set the priority'),
        agentStep({ kind: 'model', model: 'm' }, 'Write a summary'),
      ],
    });
    expect(screen.getByText('Set the priority, as AI wrote it.')).toBeTruthy();
    expect(screen.getByText('Write a summary')).toBeTruthy();
    expect(screen.getByText('1 AI call per task')).toBeTruthy();
  });

  it('reorders, duplicates and deletes steps from each step’s menu', () => {
    const steps = renderSteps({
      triggers: [email],
      steps: [
        agentStep({ kind: 'model', model: 'm' }, 'Summarize'),
        codeStep('Label invoices', 'label_invoices'),
      ],
    });
    openMenu('Step actions', 1);
    choose('Move up');
    expect(steps().map((step) => step.kind)).toEqual(['code', 'agent']);
    openMenu('Step actions', 0);
    choose('Duplicate');
    // A copy's output gets a new name when it's saved.
    expect(steps()).toMatchObject([
      { kind: 'code', output: 'label_invoices' },
      { kind: 'code', output: undefined },
      { kind: 'agent' },
    ]);
    openMenu('Step actions', 0);
    choose('Delete step');
    expect(steps().map((step) => step.kind)).toEqual(['code', 'agent']);
  });

  it('moves a step with ⌥↑, keeping focus, but leaves text fields their keys', async () => {
    const steps = renderSteps({
      triggers: [email],
      steps: [
        codeStep('Label invoices'),
        agentStep({ kind: 'model', model: 'm' }, 'Summarize'),
      ],
    });
    // ⌥↑ in the Ask AI step's instructions is the field's own navigation.
    fireEvent.click(
      screen.getByRole('button', { name: /^2.*Ask AI/, hidden: true })
    );
    const instructions = screen.getByRole('textbox', {
      name: 'Instructions',
      hidden: true,
    });
    fireEvent.keyDown(instructions, { key: 'ArrowUp', altKey: true });
    expect(steps().map((step) => step.kind)).toEqual(['code', 'agent']);
    const moving = screen.getByRole('button', {
      name: /^2.*Ask AI/,
      hidden: true,
    });
    moving.focus();
    fireEvent.keyDown(moving, { key: 'ArrowUp', altKey: true });
    expect(steps().map((step) => step.kind)).toEqual(['agent', 'code']);
    await waitFor(() =>
      expect(document.activeElement?.textContent).toMatch(/^1.*Ask AI/)
    );
  });

  it('adds the next step from a description, says why, and switches or undoes it', async () => {
    const add = vi
      .fn<StepAuthor['add']>()
      .mockResolvedValueOnce({
        step: codeStep('Escalate blocking tasks'),
        reason: 'it does the same thing every run',
      })
      .mockResolvedValueOnce({
        step: agentStep({ kind: 'model', model: 'm' }, 'Escalate them'),
        reason: 'it needs judgment',
      });
    const steps = renderSteps({
      triggers: [email],
      steps: [codeStep('Label invoices')],
      author: { add, revise: vi.fn() },
    });
    const box = screen.getByRole('textbox', { name: 'Add a step' });
    fireEvent.input(box, { target: { value: 'escalate blocking tasks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect((await screen.findByRole('status')).textContent).toContain(
      'runs the same way every time: it does the same thing'
    );
    expect(steps().map((step) => step.kind)).toEqual(['code', 'code']);
    expect((box as HTMLInputElement).value).toBe('');

    fireEvent.click(
      screen.getByRole('button', { name: 'Ask AI each run instead' })
    );
    await waitFor(() =>
      expect(steps().map((step) => step.kind)).toEqual(['code', 'agent'])
    );
    expect(add).toHaveBeenLastCalledWith('escalate blocking tasks', 'agent');
    expect(screen.getByRole('status').textContent).toContain('Added as Ask AI');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(steps().map((step) => step.kind)).toEqual(['code']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('changes a code step in words, and changes nothing until it’s kept', async () => {
    const before: CodeStepDraft = {
      ...codeStep('Escalate blocking tasks'),
      knobs: [{ type: 'number', name: 'days', label: 'Days', value: 3 }],
      sentence: 'Check tasks due within {days} days.',
    };
    const revise = vi.fn<StepAuthor['revise']>().mockResolvedValue({
      ...before,
      sentence: 'Check tasks due within {days} days and overdue tasks.',
      source: 'export async function main() { overdue(); }',
    });
    const steps = renderSteps({
      triggers: [email],
      steps: [before],
      author: { add: vi.fn(), revise },
    });
    // Saying what to change starts from the step's Edit.
    expect(
      screen.queryByRole('textbox', { name: 'Change this step' })
    ).toBeNull();
    openMenu('Step actions');
    choose('Edit');
    fireEvent.input(changeBox(), {
      target: { value: 'also include overdue tasks' },
    });
    fireEvent.submit(changeBox().closest('form')!);
    const review = await screen.findByRole('region', {
      name: 'Rewritten step',
    });
    // The box closes while the rewrite waits to be kept.
    expect(
      screen.queryByRole('textbox', { name: 'Change this step', hidden: true })
    ).toBeNull();
    expect(revise).toHaveBeenCalledWith(before, 'also include overdue tasks');
    expect(within(review).getByText('and overdue tasks').tagName).toBe('INS');
    expect(within(review).getByText('Rewritten and checked')).toBeTruthy();
    expect(
      within(review).getByText('Your values stay as they are.')
    ).toBeTruthy();
    expect(steps()[0]).toBe(before);

    fireEvent.click(
      within(review).getByRole('button', { name: 'Show code changes' })
    );
    expect(within(review).getByLabelText('Code changes').textContent).toContain(
      '+ export async function main() { overdue(); }'
    );
    fireEvent.click(within(review).getByRole('button', { name: 'Keep' }));
    expect(steps()[0]).toMatchObject({
      source: 'export async function main() { overdue(); }',
    });
    expect(screen.queryByRole('region', { name: 'Rewritten step' })).toBeNull();
  });

  it('closes the change box on Esc, and offers Edit only on code steps', () => {
    renderSteps({
      triggers: [email],
      steps: [
        codeStep('Label invoices'),
        agentStep({ kind: 'model', model: 'm' }, 'Summarize'),
      ],
      author: { add: vi.fn(), revise: vi.fn() },
    });
    openMenu('Step actions', 1);
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    fireEvent.keyDown(screen.getAllByRole('menu').at(-1)!, { key: 'Escape' });
    openMenu('Step actions', 0);
    choose('Edit');
    const box = changeBox();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(
      screen.queryByRole('textbox', { name: 'Change this step' })
    ).toBeNull();
  });

  it('always shows what a code step does, with its code behind the step’s menu', () => {
    renderSteps({
      triggers: [email],
      steps: [
        {
          ...codeStep('Label invoices'),
          knobs: [{ type: 'text', name: 'label', label: 'Label', value: 'vc' }],
          sentence: 'Label it {label}.',
        },
        agentStep({ kind: 'model', model: 'm' }, 'Summarize'),
      ],
    });
    // Code steps don't fold; Ask AI steps still do.
    expect(screen.getByText(/^Label it/).textContent).toBe('Label it vc.');
    expect(
      screen.queryByRole('button', { name: /^1.*Label invoices/ })
    ).toBeNull();
    expect(screen.getByRole('button', { name: /^2.*Ask AI/ })).toBeTruthy();
    expect(screen.queryByLabelText('Code')).toBeNull();
    openMenu('Step actions', 0);
    choose('Show code');
    expect(
      screen.getByLabelText('Code', { selector: 'pre' }).textContent
    ).toContain('export async function main');
    openMenu('Step actions', 0);
    choose('Hide code');
    expect(screen.queryByLabelText('Code', { selector: 'pre' })).toBeNull();
  });
});
