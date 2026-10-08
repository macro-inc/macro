import {
  applyLayout,
  type CollaborativeLayout,
  readLayout,
  seedLayout,
} from '@macro-inc/collaboration/forms/layout';
import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { prepareFormEdit } from './runtime';

const original: CollaborativeLayout = {
  sections: [
    {
      id: 'intro',
      kind: 'questions',
      title: 'Welcome',
      description: '',
      questions: [
        {
          id: 'name',
          column: 'name-column',
          helpText: 'Original',
          required: false,
          widget: null,
        },
      ],
    },
  ],
};

describe('Forms worker CRDT editing', () => {
  it('merges concurrent human text and fields and can replay the same delta', () => {
    const snapshot = seedLayout(original);
    const desired = structuredClone(original);
    desired.sections[0]!.questions![0]!.helpText = 'Original AI';
    const update = prepareFormEdit(snapshot, desired);
    const human = new LoroDoc();
    human.import(snapshot);
    const changed = structuredClone(original);
    changed.sections[0]!.questions![0]!.helpText = 'Human Original';
    changed.sections[0]!.questions![0]!.required = true;
    applyLayout(human, original, changed);
    human.commit();
    human.import(update);
    human.import(update);
    expect(readLayout(human).sections[0]!.questions![0]).toMatchObject({
      helpText: 'Human Original AI',
      required: true,
    });
  });

  it('does not resurrect a question removed by a human during an edit', () => {
    const snapshot = seedLayout(original);
    const desired = structuredClone(original);
    desired.sections[0]!.questions![0]!.helpText = 'Changed';
    const update = prepareFormEdit(snapshot, desired);
    const human = new LoroDoc();
    human.import(snapshot);
    const changed = structuredClone(original);
    changed.sections[0]!.questions = [];
    applyLayout(human, original, changed);
    human.commit();
    human.import(update);
    expect(readLayout(human).sections[0]!.questions).toEqual([]);
  });

  it('rejects documents with missing or unsupported form format', () => {
    const doc = new LoroDoc();
    doc.getMap('metadata').set('format', 99);
    expect(() =>
      prepareFormEdit(doc.export({ mode: 'snapshot' }), original)
    ).toThrow();
  });
});

it('bounds source and target complexity before computing edits', () => {
  const many = {
    sections: Array.from({ length: 1_001 }, (_, n) => ({
      id: String(n),
      kind: 'questions',
      questions: [],
    })),
  };
  expect(() => prepareFormEdit(seedLayout(original), many)).toThrow(
    'work limit'
  );
  expect(() => prepareFormEdit(seedLayout(many), original)).toThrow(
    'work limit'
  );
  const longText = structuredClone(original);
  longText.sections[0]!.title = 'x'.repeat(100_001);
  expect(() => prepareFormEdit(seedLayout(original), longText)).toThrow(
    'work limit'
  );
  let nested: unknown = 'value';
  for (let i = 0; i < 33; i++) nested = { child: nested };
  const deep = structuredClone(original);
  deep.sections[0]!.extra = nested;
  expect(() => prepareFormEdit(seedLayout(original), deep)).toThrow(
    'work limit'
  );
});
