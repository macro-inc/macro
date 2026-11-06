import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { type Knob, withKnobValue } from '../core/knobs';
import { StepSentence } from './routine-step-knobs';

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
    // Enter saves a number, but not one out of bounds.
    fireEvent.submit(number.closest('form')!);
    expect(current()[2]).toMatchObject({ value: 7 });
    fireEvent.click(screen.getByRole('button', { name: 'One more' }));
    expect((number as HTMLInputElement).value).toBe('1');
    fireEvent.submit(number.closest('form')!);
    expect(current()[2]).toMatchObject({ value: 1 });
  });

  it('saves the option picked from a choice’s menu', () => {
    const current = renderSentence('Set it to {priority}.');
    const trigger = screen.getByRole('button', {
      name: 'Priority: High. Change it',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(
      screen
        .getByRole('menuitemradio', { name: 'High' })
        .getAttribute('aria-checked')
    ).toBe('true');
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Urgent' }), {
      key: 'Enter',
    });
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
