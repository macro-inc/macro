import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { type Knob, withKnobValue } from '../core/knobs';
import { KnobSettings, StepSentence } from './routine-step-knobs';

afterEach(cleanup);

const knobs: Knob[] = [
  { type: 'text', name: 'label', label: 'Label', value: 'vc' },
  {
    type: 'question',
    name: 'aboutMoney',
    label: 'it’s about money',
    value: 'Is it about money?',
  },
  { type: 'number', name: 'days', label: 'Days', value: 7, min: 1 },
  { type: 'boolean', name: 'notify', label: 'Notify me', value: true },
  {
    type: 'choice',
    name: 'priority',
    label: 'Priority',
    value: 'High',
    options: ['Low', 'High', 'Urgent'],
  },
];

function renderSentence(sentence: string) {
  const [current, setCurrent] = createSignal(knobs);
  render(() => (
    <StepSentence
      sentence={sentence}
      knobs={current()}
      onKnob={(name, value) =>
        setCurrent(withKnobValue(current(), name, value))
      }
    />
  ));
  return current;
}

describe('a step’s sentence', () => {
  it('shows each knob in place, and changes a value from its editor', async () => {
    const current = renderSentence('Label it {label} when {?aboutMoney}.');
    expect(screen.getByText(/Label it/).textContent).toBe(
      'Label it vc when it’s about money.'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Label: vc. Change it' })
    );
    const field = await screen.findByRole('textbox', { name: 'Label' });
    fireEvent.input(field, { target: { value: 'finance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(current()[0]).toMatchObject({ value: 'finance' });
    expect(
      screen.getByRole('button', { name: 'Label: finance. Change it' })
    ).toBeTruthy();
  });

  it('rewords what AI is asked, and refuses a value out of bounds', async () => {
    const current = renderSentence('When {?aboutMoney}, wait {days} days.');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'AI decides whether it’s about money. Change the question',
      })
    );
    const question = await screen.findByRole('textbox', {
      name: 'What AI is asked',
    });
    fireEvent.input(question, { target: { value: 'Is it a bill to pay?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(current()[1]).toMatchObject({ value: 'Is it a bill to pay?' });

    fireEvent.click(screen.getByRole('button', { name: 'Days: 7. Change it' }));
    const number = await screen.findByRole('spinbutton', { name: 'Days' });
    expect(screen.getByText('1 or more')).toBeTruthy();
    fireEvent.input(number, { target: { value: '0' } });
    expect(screen.getByText('Use 1 or more.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'One more' }));
    expect((number as HTMLInputElement).value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(current()[2]).toMatchObject({ value: 1 });
  });

  it('saves the option picked from a choice only on Save', async () => {
    const current = renderSentence('Set it to {priority}.');
    const trigger = screen.getByRole('button', {
      name: 'Priority: High. Change it',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const high = await screen.findByRole('radio', { name: 'High' });
    await waitFor(() => expect(document.activeElement).toBe(high));
    expect((high as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Urgent' }));
    expect(current()[4]).toMatchObject({ value: 'High' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(current()[4]).toMatchObject({ value: 'Urgent' });
    expect(
      screen.getByRole('button', { name: 'Priority: Urgent. Change it' })
    ).toBeTruthy();
  });

  it('flips an on/off knob in place', () => {
    const current = renderSentence('Notify me: {notify}.');
    fireEvent.click(screen.getByRole('button', { name: 'Notify me: on' }));
    expect(current()[3]).toMatchObject({ value: false });
    expect(screen.getByRole('button', { name: 'Notify me: off' })).toBeTruthy();
  });
});

describe('a knob with no value', () => {
  const empty: Knob = {
    type: 'text',
    name: 'project',
    label: 'Project',
    value: '',
  };

  it('shows its label in the sentence, as a value to set', async () => {
    const [current, setCurrent] = createSignal<Knob[]>([empty]);
    render(() => (
      <StepSentence
        sentence="Make a ticket in {project} for each message."
        knobs={current()}
        onKnob={(name, value) =>
          setCurrent(withKnobValue(current(), name, value))
        }
      />
    ));
    expect(screen.getByText(/Make a ticket/).textContent).toBe(
      'Make a ticket in Project for each message.'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Project: not set. Set it' })
    );
    const field = await screen.findByRole('textbox', { name: 'Project' });
    fireEvent.input(field, { target: { value: 'Bugs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(current()[0]).toMatchObject({ value: 'Bugs' });
    expect(
      screen.getByRole('button', { name: 'Project: Bugs. Change it' })
    ).toBeTruthy();
  });

  it('reads as not set in the settings list', () => {
    render(() => <KnobSettings knobs={[empty]} onKnob={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Project: not set. Set it' })
        .textContent
    ).toBe('Not set');
  });
});

describe('a knob’s editor', () => {
  it('never saves on Enter', async () => {
    const current = renderSentence('Label it {label}, wait {days} days.');
    fireEvent.click(
      screen.getByRole('button', { name: 'Label: vc. Change it' })
    );
    const field = await screen.findByRole('textbox', { name: 'Label' });
    fireEvent.input(field, { target: { value: 'finance' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.submit(field.closest('form') ?? field);
    expect(current()[0]).toMatchObject({ value: 'vc' });
    expect(screen.getByRole('textbox', { name: 'Label' })).toBeTruthy();
    expect(screen.queryByText('Enter saves · Esc cancels')).toBeNull();
  });

  it('clears a text value, which Save then stores', async () => {
    const current = renderSentence('Label it {label}.');
    fireEvent.click(
      screen.getByRole('button', { name: 'Label: vc. Change it' })
    );
    const field = await screen.findByRole('textbox', { name: 'Label' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((field as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(field);
    expect(current()[0]).toMatchObject({ value: 'vc' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(current()[0]).toMatchObject({ value: '' });
    expect(
      screen.getByRole('button', { name: 'Label: not set. Set it' })
    ).toBeTruthy();
  });

  it('clears a choice, and saves once an option is picked again', async () => {
    const current = renderSentence('Set it to {priority}.');
    fireEvent.click(
      screen.getByRole('button', { name: 'Priority: High. Change it' })
    );
    await screen.findByRole('radio', { name: 'High' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    const save = screen.getByRole('button', {
      name: 'Save',
    }) as HTMLButtonElement;
    expect(
      (screen.getByRole('radio', { name: 'High' }) as HTMLInputElement).checked
    ).toBe(false);
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Low' }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(current()[4]).toMatchObject({ value: 'Low' });
  });

  it('discards the change on Escape', async () => {
    const current = renderSentence('Label it {label}.');
    fireEvent.click(
      screen.getByRole('button', { name: 'Label: vc. Change it' })
    );
    const field = await screen.findByRole('textbox', { name: 'Label' });
    fireEvent.input(field, { target: { value: 'finance' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    const trigger = screen.getByRole('button', {
      name: 'Label: vc. Change it',
    });
    await waitFor(() =>
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    );
    expect(current()[0]).toMatchObject({ value: 'vc' });
    // Reopened, it starts from the saved value again.
    fireEvent.click(trigger);
    expect(
      (
        (await screen.findByRole('textbox', {
          name: 'Label',
        })) as HTMLInputElement
      ).value
    ).toBe('vc');
  });
});
