import { describe, expect, it } from 'vitest';
import {
  type Knob,
  knobsOutsideSentence,
  knobText,
  knobToWire,
  knobValueProblem,
  sentenceParts,
  sentenceText,
  type UnusableItem,
  unusableInStep,
  unusableReason,
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

describe('entity knobs', () => {
  const bugs: Knob = {
    type: 'entity',
    name: 'bugs',
    label: 'Channel to post in',
    entity_types: ['channel'],
    value: { type: 'channel', id: 'channel-1' },
  };

  it('take only an item of a kind they allow', () => {
    const other = { type: 'channel' as const, id: 'channel-2' };
    expect(knobValueProblem(bugs, other)).toBeUndefined();
    expect(knobValueProblem(bugs, { type: 'document', id: 'doc-1' })).toBe(
      'Pick a channel.'
    );
    expect(knobValueProblem(bugs, 'bug-reports')).toBe('Pick a channel.');
    expect(withKnobValue([bugs], 'bugs', other)).toEqual([
      { ...bugs, value: other },
    ]);
    expect(withKnobValue([bugs], 'bugs', 'bug-reports')).toEqual([bugs]);
    // A knob allowing several kinds asks for "an item".
    const either: Knob = { ...bugs, entity_types: ['channel', 'document'] };
    expect(knobValueProblem(either, null)).toBe('Pick an item.');
    expect(knobText({ ...either, value: null })).toBe('an item');
  });

  it('round-trip, including a starter’s knob with nothing picked', () => {
    const unpicked = { ...bugs, name: 'next', value: null };
    const stored = [
      {
        type: 'code' as const,
        title: 'Post bugs',
        source: 'export async function main() {}',
        knobs: [bugs, unpicked],
        sentence: 'Post open bugs in {bugs}, then {next}.',
      },
    ];
    const steps = stepsFromWire(stored);
    expect(steps?.[0]).toMatchObject({ knobs: [bugs, unpicked] });
    expect(stepsToWire(steps!)).toEqual(stored);
    expect(
      sentenceText('Post open bugs in {bugs}, then {next}.', [bugs, unpicked])
    ).toBe('Post open bugs in the chosen channel, then a channel.');
  });
});

describe('knobs needing a new pick', () => {
  const archive: Knob = {
    type: 'entity',
    name: 'archive',
    label: 'Archive channel',
    entity_types: ['channel'],
    value: { type: 'channel', id: 'gone' },
  };
  const notify: Knob = {
    ...archive,
    name: 'notify',
    label: 'Notification channel',
  };
  const gone = { type: 'channel' as const, id: 'gone' };
  const reason = (label: string) =>
    `The channel picked for "${label}" was deleted.`;
  // By the saved step's id, as the scheduler lists them.
  const unusable: UnusableItem[] = [
    {
      step: 'post',
      knob: 'notify',
      item: gone,
      reason: reason('Notification channel'),
    },
    {
      step: 'post',
      knob: 'archive',
      item: gone,
      reason: reason('Archive channel'),
    },
    { step: 'file', knob: 'archive', item: gone, reason: reason('Step two') },
  ];

  it('keep each on its own step, by id', () => {
    expect(unusableInStep(unusable, 'post').map((entry) => entry.knob)).toEqual(
      ['notify', 'archive']
    );
    // A step not saved yet has none.
    expect(unusableInStep(unusable, undefined)).toEqual([]);
    // A list from before a save that removed 'post' puts none of its entries
    // on the step left, though they share a knob name and an item.
    expect(
      unusableInStep(unusable, 'file').map((entry) => entry.reason)
    ).toEqual([reason('Step two')]);
  });

  it('give each knob holding the same item the reason naming it', () => {
    const own = unusableInStep(unusable, 'post');
    expect(unusableReason(archive, own)).toBe(reason('Archive channel'));
    expect(unusableReason(notify, own)).toBe(reason('Notification channel'));
    // A knob of the same name in another step has its own reason.
    expect(unusableReason(archive, unusableInStep(unusable, 'file'))).toBe(
      reason('Step two')
    );
  });

  it('give none to a knob picked again since', () => {
    const picked: Knob = { ...archive, value: { type: 'channel', id: 'new' } };
    expect(
      unusableReason(picked, unusableInStep(unusable, 'post'))
    ).toBeUndefined();
  });
});
