import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoroDoc, LoroMap, LoroMovableList, LoroText } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  applyLayout,
  type CollaborativeLayout,
  type CollaborativeSection,
  FORMAT_VERSION,
  LAYOUT_CONTAINERS,
  readLayout,
  seedLayout,
} from './collaboration-layout';

const CONTACT = '0199a000-0000-7000-8000-000000000001';
const SCREENING = '0199a000-0000-7000-8000-000000000002';
const DETAILS = '0199a000-0000-7000-8000-000000000003';
const NAME = '0199a000-0000-7000-8000-000000000011';
const EMAIL = '0199a000-0000-7000-8000-000000000012';
const PHONE = '0199a000-0000-7000-8000-000000000013';
const ADDRESS = '0199a000-0000-7000-8000-000000000014';
const OTHER = '0199a000-0000-7000-8000-000000000015';
const NAME_COLUMN = '0199a000-0000-7000-8000-000000000021';
const EMAIL_COLUMN = '0199a000-0000-7000-8000-000000000022';
const PHONE_COLUMN = '0199a000-0000-7000-8000-000000000023';
const ADDRESS_COLUMN = '0199a000-0000-7000-8000-000000000024';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../crates/forms/fixtures/collaboration'
);

/** The layout both cross-language fixtures hold. */
const fixtureLayout: CollaborativeLayout = {
  sections: [
    {
      kind: 'questions',
      id: CONTACT,
      title: 'Contact',
      description: 'How we reach you',
      questions: [
        {
          id: NAME,
          column: NAME_COLUMN,
          helpText: 'Your full name',
          required: true,
          widget: 'short',
        },
        {
          id: EMAIL,
          column: EMAIL_COLUMN,
          helpText: '',
          required: false,
          widget: null,
        },
      ],
    },
    {
      kind: 'gate',
      id: SCREENING,
      title: 'Screening',
      description: '',
      rules: {
        conjunction: 'and',
        conditions: [
          {
            kind: 'condition',
            column: NAME_COLUMN,
            test: { kind: 'text', operator: 'is', value: 'Ada' },
          },
        ],
      },
      message: 'Only Ada may continue',
    },
    {
      kind: 'questions',
      id: DETAILS,
      title: 'Details',
      description: '',
      questions: [],
    },
  ],
};

/** Two question sections, the starting point of every concurrency test. */
const sharedLayout: CollaborativeLayout = {
  sections: [
    {
      kind: 'questions',
      id: CONTACT,
      title: 'Contact',
      description: '',
      questions: [
        {
          id: NAME,
          column: NAME_COLUMN,
          helpText: 'Your name',
          required: false,
          widget: null,
        },
        {
          id: EMAIL,
          column: EMAIL_COLUMN,
          helpText: '',
          required: false,
          widget: null,
        },
        {
          id: PHONE,
          column: PHONE_COLUMN,
          helpText: '',
          required: false,
          widget: null,
        },
      ],
    },
    {
      kind: 'questions',
      id: DETAILS,
      title: 'Details',
      description: '',
      questions: [],
    },
  ],
};

describe('seedLayout and readLayout', () => {
  it('read back the layout they seed', () => {
    const document = LoroDoc.fromSnapshot(seedLayout(fixtureLayout));

    expect(readLayout(document)).toEqual(fixtureLayout);
  });

  it('store the shared schema', () => {
    const document = LoroDoc.fromSnapshot(seedLayout(fixtureLayout));

    expect(document.getMap(LAYOUT_CONTAINERS.metadata).toJSON()).toEqual({
      format: FORMAT_VERSION,
    });
    expect(
      document.getMovableList(LAYOUT_CONTAINERS.sectionOrder).toJSON()
    ).toEqual([CONTACT, SCREENING, DETAILS]);
    expect(document.getMap(LAYOUT_CONTAINERS.questionOrders).toJSON()).toEqual({
      [CONTACT]: [NAME, EMAIL],
      [DETAILS]: [],
    });
    const gate = document.getMap(LAYOUT_CONTAINERS.sections).get(SCREENING);
    if (!(gate instanceof LoroMap)) throw new Error('the gate is not a map');
    expect(gate.get('message')).toBeInstanceOf(LoroText);
    expect(gate.get('title')).toBeInstanceOf(LoroText);
    expect(JSON.parse(String(gate.get('rules')))).toEqual({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: NAME_COLUMN,
          test: { kind: 'text', operator: 'is', value: 'Ada' },
        },
      ],
    });
    const name = document.getMap(LAYOUT_CONTAINERS.questions).get(NAME);
    if (!(name instanceof LoroMap))
      throw new Error('the question is not a map');
    expect(name.get('helpText')).toBeInstanceOf(LoroText);
    expect(name.toJSON()).toEqual({
      sectionId: CONTACT,
      column: NAME_COLUMN,
      helpText: 'Your full name',
      required: true,
      widget: 'short',
    });
  });

  it('read the layout the Rust codec seeded', () => {
    const document = LoroDoc.fromSnapshot(
      readFileSync(join(FIXTURES, 'rust-seeded.loro'))
    );

    expect(readLayout(document)).toEqual(fixtureLayout);
  });

  it('read the checked-in TypeScript fixture', () => {
    const document = LoroDoc.fromSnapshot(
      readFileSync(join(FIXTURES, 'typescript-seeded.loro'))
    );

    expect(readLayout(document)).toEqual(fixtureLayout);
  });

  // Rewrites the fixture the Rust codec reads. Run by hand with
  // WRITE_FORMS_COLLABORATION_FIXTURE=1.
  it.runIf(process.env.WRITE_FORMS_COLLABORATION_FIXTURE === '1')(
    'write the TypeScript fixture',
    () => {
      writeFileSync(
        join(FIXTURES, 'typescript-seeded.loro'),
        seedLayout(fixtureLayout)
      );
    }
  );
});

describe('applyLayout', () => {
  it('keeps a remote edit to a field it did not change', () => {
    const snapshot = seedLayout(sharedLayout);
    const local = LoroDoc.fromSnapshot(snapshot);
    const remote = LoroDoc.fromSnapshot(snapshot);
    applyLayout(remote, sharedLayout, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your legal name',
              required: true,
              widget: null,
            },
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    });
    remote.commit();
    local.import(remote.export({ mode: 'snapshot' }));

    applyLayout(local, sharedLayout, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact us',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your name',
              required: false,
              widget: null,
            },
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    });
    local.commit();

    expect(readLayout(local)).toEqual({
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact us',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your legal name',
              required: true,
              widget: null,
            },
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    });
  });

  it('merges concurrent edits to one text', () => {
    const snapshot = seedLayout(sharedLayout);
    const first = LoroDoc.fromSnapshot(snapshot);
    const second = LoroDoc.fromSnapshot(snapshot);
    applyLayout(first, sharedLayout, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact form',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your name',
              required: false,
              widget: null,
            },
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    });
    applyLayout(second, sharedLayout, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Our contact',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your name',
              required: false,
              widget: null,
            },
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    });
    first.commit();
    second.commit();
    const firstSnapshot = first.export({ mode: 'snapshot' });
    first.import(second.export({ mode: 'snapshot' }));
    second.import(firstSnapshot);

    expect(readLayout(first)).toEqual(readLayout(second));
    expect(readLayout(first).sections[0]?.title).toBe('Our contact form');
  });

  it('keeps both questions inserted into one slot', () => {
    const snapshot = seedLayout(sharedLayout);
    const first = LoroDoc.fromSnapshot(snapshot);
    const second = LoroDoc.fromSnapshot(snapshot);
    applyLayout(first, sharedLayout, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your name',
              required: false,
              widget: null,
            },
            {
              id: ADDRESS,
              column: ADDRESS_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    });
    applyLayout(second, sharedLayout, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your name',
              required: false,
              widget: null,
            },
            {
              id: OTHER,
              column: ADDRESS_COLUMN,
              helpText: 'Another',
              required: true,
              widget: null,
            },
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    });
    first.commit();
    second.commit();
    const firstSnapshot = first.export({ mode: 'snapshot' });
    first.import(second.export({ mode: 'snapshot' }));
    second.import(firstSnapshot);

    expect(readLayout(first)).toEqual(readLayout(second));
    const order = readLayout(first).sections[0]?.questions?.map(
      (question) => question.id
    );
    expect(order).toHaveLength(5);
    expect(order?.[0]).toBe(NAME);
    expect(order?.slice(1, 3)).toEqual(
      expect.arrayContaining([ADDRESS, OTHER])
    );
    expect(order?.slice(3)).toEqual([EMAIL, PHONE]);
  });

  it('keeps an edit to a question moved across sections concurrently', () => {
    const snapshot = seedLayout(sharedLayout);
    const mover = LoroDoc.fromSnapshot(snapshot);
    const editor = LoroDoc.fromSnapshot(snapshot);
    applyLayout(mover, sharedLayout, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact',
          description: '',
          questions: [
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your name',
              required: false,
              widget: null,
            },
          ],
        },
      ],
    });
    applyLayout(editor, sharedLayout, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your full name',
              required: true,
              widget: 'paragraph',
            },
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    });
    mover.commit();
    editor.commit();
    const moverSnapshot = mover.export({ mode: 'snapshot' });
    mover.import(editor.export({ mode: 'snapshot' }));
    editor.import(moverSnapshot);

    expect(readLayout(mover)).toEqual(readLayout(editor));
    expect(readLayout(mover)).toEqual({
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact',
          description: '',
          questions: [
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your full name',
              required: true,
              widget: 'paragraph',
            },
          ],
        },
      ],
    });
  });

  it('moves rather than reinserts a question reordered within its section', () => {
    const snapshot = seedLayout(sharedLayout);
    const first = LoroDoc.fromSnapshot(snapshot);
    const second = LoroDoc.fromSnapshot(snapshot);
    const reordered: CollaborativeLayout = {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact',
          description: '',
          questions: [
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your name',
              required: false,
              widget: null,
            },
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    };
    applyLayout(first, sharedLayout, reordered);
    applyLayout(second, sharedLayout, reordered);
    first.commit();
    second.commit();
    first.import(second.export({ mode: 'snapshot' }));

    const order = first.getMap(LAYOUT_CONTAINERS.questionOrders).get(CONTACT);
    if (!(order instanceof LoroMovableList)) {
      throw new Error('the contact order is not a movable list');
    }
    expect(order.toJSON()).toEqual([PHONE, NAME, EMAIL]);
    expect(readLayout(first)).toEqual(reordered);
  });

  it('keeps a deleted question deleted when moved concurrently', () => {
    const snapshot = seedLayout(sharedLayout);
    const deleter = LoroDoc.fromSnapshot(snapshot);
    const mover = LoroDoc.fromSnapshot(snapshot);
    applyLayout(deleter, sharedLayout, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact',
          description: '',
          questions: [
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    });
    applyLayout(mover, sharedLayout, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact',
          description: '',
          questions: [
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Moved last',
              required: true,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    });
    deleter.commit();
    mover.commit();
    const deleterSnapshot = deleter.export({ mode: 'snapshot' });
    deleter.import(mover.export({ mode: 'snapshot' }));
    mover.import(deleterSnapshot);

    const expected: CollaborativeLayout = {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Contact',
          description: '',
          questions: [
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    };
    expect(readLayout(deleter)).toEqual(expected);
    expect(readLayout(mover)).toEqual(expected);
  });

  it('keeps fields the layout does not model', () => {
    const document = LoroDoc.fromSnapshot(seedLayout(sharedLayout));
    const contact = document.getMap(LAYOUT_CONTAINERS.sections).get(CONTACT);
    if (!(contact instanceof LoroMap))
      throw new Error('the section is not a map');
    contact.set('theme', '{"accent":"teal"}');

    applyLayout(document, sharedLayout, {
      sections: [
        {
          kind: 'questions',
          id: CONTACT,
          title: 'Renamed',
          description: '',
          questions: [
            {
              id: NAME,
              column: NAME_COLUMN,
              helpText: 'Your name',
              required: false,
              widget: null,
            },
            {
              id: EMAIL,
              column: EMAIL_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: PHONE,
              column: PHONE_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
          ],
        },
        {
          kind: 'questions',
          id: DETAILS,
          title: 'Details',
          description: '',
          questions: [],
        },
      ],
    });

    expect(contact.get('theme')).toBe('{"accent":"teal"}');
    expect(readLayout(document).sections[0]).toEqual({
      kind: 'questions',
      id: CONTACT,
      title: 'Renamed',
      description: '',
      theme: { accent: 'teal' },
      questions: [
        {
          id: NAME,
          column: NAME_COLUMN,
          helpText: 'Your name',
          required: false,
          widget: null,
        },
        {
          id: EMAIL,
          column: EMAIL_COLUMN,
          helpText: '',
          required: false,
          widget: null,
        },
        {
          id: PHONE,
          column: PHONE_COLUMN,
          helpText: '',
          required: false,
          widget: null,
        },
      ],
    });
  });

  it('refuses a layout naming a section twice', () => {
    const document = LoroDoc.fromSnapshot(seedLayout(sharedLayout));

    expect(() =>
      applyLayout(document, sharedLayout, {
        sections: [
          {
            kind: 'questions',
            id: CONTACT,
            title: 'Contact',
            description: '',
            questions: [],
          },
          {
            kind: 'questions',
            id: CONTACT,
            title: 'Again',
            description: '',
            questions: [],
          },
        ],
      })
    ).toThrow(
      expect.objectContaining({
        problem: { kind: 'duplicate-section', id: CONTACT },
      })
    );
  });

  it('refuses a layout naming a question twice', () => {
    expect(() =>
      seedLayout({
        sections: [
          {
            kind: 'questions',
            id: CONTACT,
            title: 'Contact',
            description: '',
            questions: [
              {
                id: NAME,
                column: NAME_COLUMN,
                helpText: '',
                required: false,
                widget: null,
              },
            ],
          },
          {
            kind: 'questions',
            id: DETAILS,
            title: 'Details',
            description: '',
            questions: [
              {
                id: NAME,
                column: EMAIL_COLUMN,
                helpText: '',
                required: false,
                widget: null,
              },
            ],
          },
        ],
      })
    ).toThrow(
      expect.objectContaining({
        problem: { kind: 'duplicate-question', id: NAME },
      })
    );
  });
});

describe('readLayout', () => {
  it('refuses a document without a format', () => {
    const document = new LoroDoc();
    document.getMap(LAYOUT_CONTAINERS.sections).set('unrelated', true);

    expect(() => readLayout(document)).toThrow(
      expect.objectContaining({ problem: { kind: 'missing-format' } })
    );
  });

  it('refuses an unknown format', () => {
    const document = LoroDoc.fromSnapshot(seedLayout(sharedLayout));
    document.getMap(LAYOUT_CONTAINERS.metadata).set('format', 2);

    expect(() => readLayout(document)).toThrow(
      expect.objectContaining({
        problem: { kind: 'unsupported-format', format: '2' },
      })
    );
    expect(() => applyLayout(document, sharedLayout, sharedLayout)).toThrow(
      expect.objectContaining({
        problem: { kind: 'unsupported-format', format: '2' },
      })
    );
  });

  it('refuses a title stored as a plain string', () => {
    const document = LoroDoc.fromSnapshot(seedLayout(sharedLayout));
    const contact = document.getMap(LAYOUT_CONTAINERS.sections).get(CONTACT);
    if (!(contact instanceof LoroMap))
      throw new Error('the section is not a map');
    contact.set('title', 'plain');

    expect(() => readLayout(document)).toThrow(
      expect.objectContaining({
        problem: {
          kind: 'malformed',
          location: `sections.${CONTACT}.title`,
          expected: 'text',
        },
      })
    );
  });

  it('refuses rules that are not JSON', () => {
    const document = LoroDoc.fromSnapshot(seedLayout(fixtureLayout));
    const gate = document.getMap(LAYOUT_CONTAINERS.sections).get(SCREENING);
    if (!(gate instanceof LoroMap)) throw new Error('the gate is not a map');
    gate.set('rules', '{ not json');

    expect(() => readLayout(document)).toThrow(
      expect.objectContaining({
        problem: {
          kind: 'invalid-json',
          location: `sections.${SCREENING}.rules`,
        },
      })
    );
  });

  it('refuses a question field of the wrong type', () => {
    const document = LoroDoc.fromSnapshot(seedLayout(sharedLayout));
    const name = document.getMap(LAYOUT_CONTAINERS.questions).get(NAME);
    if (!(name instanceof LoroMap))
      throw new Error('the question is not a map');
    name.set('required', 'yes');

    expect(() => readLayout(document)).toThrow(
      expect.objectContaining({
        problem: {
          kind: 'malformed',
          location: `questions.${NAME}.required`,
          expected: 'a boolean',
        },
      })
    );
  });

  it('refuses an order entry that is not an id', () => {
    const document = LoroDoc.fromSnapshot(seedLayout(sharedLayout));
    document.getMovableList(LAYOUT_CONTAINERS.sectionOrder).push(7);

    expect(() => readLayout(document)).toThrow(
      expect.objectContaining({
        problem: {
          kind: 'malformed',
          location: 'sectionOrder.2',
          expected: 'a section id',
        },
      })
    );
  });

  it('skips repeated and dangling order entries', () => {
    const document = LoroDoc.fromSnapshot(seedLayout(sharedLayout));
    const sectionOrder = document.getMovableList(
      LAYOUT_CONTAINERS.sectionOrder
    );
    sectionOrder.insert(0, DETAILS);
    sectionOrder.push('0199a000-0000-7000-8000-0000000000ff');

    expect(readLayout(document).sections.map((section) => section.id)).toEqual([
      DETAILS,
      CONTACT,
    ]);
  });
});

describe('booking order', () => {
  const BOOKING = '0199a000-0000-7000-8000-000000000004';
  const SECOND_BOOKING = '0199a000-0000-7000-8000-000000000005';
  const TRAVEL = '0199a000-0000-7000-8000-000000000006';
  const contact: CollaborativeSection = {
    kind: 'questions',
    id: CONTACT,
    title: 'Contact',
    description: '',
    questions: [
      {
        id: NAME,
        column: NAME_COLUMN,
        helpText: '',
        required: false,
        widget: null,
      },
    ],
  };
  const details: CollaborativeSection = {
    kind: 'questions',
    id: DETAILS,
    title: 'Details',
    description: '',
    questions: [],
  };
  const travel: CollaborativeSection = {
    kind: 'questions',
    id: TRAVEL,
    title: 'Travel',
    description: '',
    questions: [],
  };
  const introBooking: CollaborativeSection = {
    kind: 'booking',
    id: BOOKING,
    title: 'Book a call',
    description: '',
    target: {
      profileId: '0199a000-0000-7000-8000-000000000031',
      eventTypeId: '0199a000-0000-7000-8000-000000000032',
    },
  };
  const reviewBooking: CollaborativeSection = {
    kind: 'booking',
    id: SECOND_BOOKING,
    title: 'Book a review',
    description: '',
    target: {
      profileId: '0199a000-0000-7000-8000-000000000031',
      eventTypeId: '0199a000-0000-7000-8000-000000000033',
    },
  };

  /** `layout` edited into a copy of `snapshot` by the Loro peer `peer`. */
  function editAs(
    peer: bigint,
    snapshot: Uint8Array,
    layout: CollaborativeLayout
  ): LoroDoc {
    const document = LoroDoc.fromSnapshot(snapshot);
    document.setPeerId(peer);
    applyLayout(document, readLayout(document), layout);
    document.commit();
    return document;
  }

  function merged(first: LoroDoc, second: LoroDoc): LoroDoc {
    const document = LoroDoc.fromSnapshot(first.export({ mode: 'snapshot' }));
    document.import(second.export({ mode: 'snapshot' }));
    return document;
  }

  it('reads a booking step stored before a section last', () => {
    const document = LoroDoc.fromSnapshot(
      seedLayout({ sections: [contact, details, introBooking] })
    );
    document.getMovableList(LAYOUT_CONTAINERS.sectionOrder).move(2, 0);
    document.commit();

    expect(readLayout(document)).toEqual({
      sections: [contact, details, introBooking],
    });
  });

  it('keeps a booking step last beside a section added at the end concurrently', () => {
    const snapshot = seedLayout({ sections: [contact, details] });
    const stored: unknown[][] = [];
    for (const [bookingPeer, travelPeer] of [
      [1n, 2n],
      [2n, 1n],
    ] as const) {
      const booked = editAs(bookingPeer, snapshot, {
        sections: [contact, details, introBooking],
      });
      const travelled = editAs(travelPeer, snapshot, {
        sections: [contact, details, travel],
      });

      const bookedFirst = merged(booked, travelled);
      const travelledFirst = merged(travelled, booked);
      stored.push(
        bookedFirst.getMovableList(LAYOUT_CONTAINERS.sectionOrder).toArray()
      );
      expect(readLayout(bookedFirst)).toEqual({
        sections: [contact, details, travel, introBooking],
      });
      expect(readLayout(travelledFirst)).toEqual(readLayout(bookedFirst));
    }
    expect(stored).toContainEqual([CONTACT, DETAILS, BOOKING, TRAVEL]);
  });

  it('reads two concurrent booking steps last, and an edit or a delete repairs them', () => {
    const snapshot = seedLayout({ sections: [contact, details] });
    const document = merged(
      editAs(1n, snapshot, { sections: [contact, details, introBooking] }),
      editAs(2n, snapshot, { sections: [contact, details, reviewBooking] })
    );

    const both = readLayout(document);
    expect(both.sections.slice(0, 2)).toEqual([contact, details]);
    expect(both.sections.slice(2)).toHaveLength(2);
    expect(both.sections.slice(2)).toEqual(
      expect.arrayContaining([introBooking, reviewBooking])
    );

    const renamed = {
      sections: both.sections.map((section) =>
        section.id === CONTACT ? { ...section, title: 'Contact us' } : section
      ),
    };
    applyLayout(document, both, renamed);
    document.commit();
    expect(readLayout(document)).toEqual(renamed);

    applyLayout(document, renamed, {
      sections: renamed.sections.filter(
        (section) => section.id !== SECOND_BOOKING
      ),
    });
    document.commit();
    expect(readLayout(document)).toEqual({
      sections: [{ ...contact, title: 'Contact us' }, details, introBooking],
    });
  });

  it('moves a section where asked over a booking step stored mid-order', () => {
    const document = LoroDoc.fromSnapshot(
      seedLayout({ sections: [contact, details, introBooking] })
    );
    document.getMovableList(LAYOUT_CONTAINERS.sectionOrder).move(2, 1);
    document.commit();

    applyLayout(document, readLayout(document), {
      sections: [details, contact, introBooking],
    });
    document.commit();

    expect(readLayout(document)).toEqual({
      sections: [details, contact, introBooking],
    });
  });
});
