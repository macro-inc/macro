import { describe, expect, it } from 'vitest';
import {
  type Knob,
  knobsOutsideSentence,
  knobToWire,
  knobValueProblem,
  sentenceParts,
  sentenceText,
  withKnobValue,
} from './knobs';
import { stepsFromWire, stepsToWire } from './routine-steps';

const label: Knob = {
  type: 'text',
  name: 'label',
  label: 'Label for money email',
  value: 'vc',
};
const aboutMoney: Knob = {
  type: 'question',
  name: 'aboutMoney',
  label: 'it’s about money',
  value: 'Is this email about money?',
};
const days: Knob = {
  type: 'number',
  name: 'days',
  label: 'Days',
  value: 7,
  min: 1,
  max: 60,
};
const priority: Knob = {
  type: 'choice',
  name: 'priority',
  label: 'Priority',
  value: 'High',
  options: ['Low', 'High'],
};

describe('step sentences', () => {
  it('splits a sentence into words and its knobs', () => {
    expect(
      sentenceParts('Label it {label} when {?aboutMoney}.', [label, aboutMoney])
    ).toEqual([
      { kind: 'text', text: 'Label it ' },
      { kind: 'knob', knob: label },
      { kind: 'text', text: ' when ' },
      { kind: 'knob', knob: aboutMoney },
      { kind: 'text', text: '.' },
    ]);
  });

  it('gives up on slots saving would refuse', () => {
    const knobs = [label, aboutMoney];
    for (const sentence of [
      'Label it {missing}',
      'Label it {aboutMoney}',
      'Label it {?label}',
      'Label it {label',
      'Label it label}',
    ])
      expect(sentenceParts(sentence, knobs), sentence).toBeUndefined();
  });

  it('reads with each value in place, and lists the knobs it leaves out', () => {
    const knobs = [label, aboutMoney, days];
    const sentence = 'Label it {label} when {?aboutMoney}.';
    expect(sentenceText(sentence, knobs)).toBe(
      'Label it vc when it’s about money.'
    );
    expect(sentenceText(undefined, knobs)).toBeUndefined();
    expect(knobsOutsideSentence(sentence, knobs)).toEqual([days]);
    expect(knobsOutsideSentence(undefined, knobs)).toEqual(knobs);
  });
});

describe('knob values', () => {
  it('holds each value to its knob’s limits', () => {
    expect(knobValueProblem(days, 7)).toBeUndefined();
    expect(knobValueProblem(days, 0)).toBe('Use 1 or more.');
    expect(knobValueProblem(days, 61)).toBe('Use 60 or less.');
    expect(knobValueProblem(days, Number.NaN)).toBe('Enter a number.');
    expect(knobValueProblem(priority, 'Urgent')).toBe(
      'Pick one of the options.'
    );
    expect(knobValueProblem(aboutMoney, ' ')).toBe(
      'Write the question AI should answer.'
    );
    expect(knobValueProblem(label, 'x'.repeat(501))).toBe(
      'Use at most 500 characters.'
    );
  });

  it('changes only the named knob, and only to a value of its type', () => {
    expect(withKnobValue([label, days], 'days', 14)).toEqual([
      label,
      { ...days, value: 14 },
    ]);
    expect(withKnobValue([label, days], 'days', 'fourteen')).toEqual([
      label,
      days,
    ]);
  });

  it('round-trips a code step’s knobs and sentence through its stored shape', () => {
    const stored = [
      {
        type: 'code' as const,
        title: 'Label',
        source: 'export async function main() {}',
        knobs: [
          label,
          { type: 'number' as const, name: 'days', label: 'Days', value: 3 },
        ],
        sentence: 'Label it {label}.',
      },
    ];
    const steps = stepsFromWire(stored);
    expect(steps?.[0]).toMatchObject({
      knobs: stored[0]!.knobs,
      sentence: 'Label it {label}.',
    });
    expect(stepsToWire(steps!)).toEqual(stored);
    // Unset bounds stay off the wire.
    expect(knobToWire({ ...days, min: undefined, max: undefined })).toEqual({
      type: 'number',
      name: 'days',
      label: 'Days',
      value: 7,
    });
  });
});
