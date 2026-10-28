import type { ElicitationSchema } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { initialValues, toContent, validate } from './elicitation-form';

/** The Claude Code single-select question after the fold collapsed its pair. */
const colour: ElicitationSchema = {
  title: null,
  description: null,
  required: ['question_0'],
  properties: [
    {
      name: 'question_0',
      title: 'Best colour',
      description: null,
      schema: {
        type: 'string',
        minLength: null,
        maxLength: null,
        pattern: null,
        format: null,
        default: null,
        options: [
          { value: 'Red', title: 'Red', description: 'Red' },
          { value: 'Blue', title: 'Blue', description: 'Blue' },
        ],
        customField: 'question_0_custom',
      },
    },
  ],
};

const config: ElicitationSchema = {
  title: 'Config',
  description: null,
  required: ['name', 'port'],
  properties: [
    {
      name: 'name',
      title: 'Name',
      description: null,
      schema: {
        type: 'string',
        minLength: 2,
        maxLength: 5,
        pattern: '^[a-z]+$',
        format: null,
        default: 'svc',
        options: [],
        customField: null,
      },
    },
    {
      name: 'port',
      title: 'Port',
      description: null,
      schema: { type: 'integer', minimum: 1024, maximum: 65535, default: 3000 },
    },
    {
      name: 'ratio',
      title: null,
      description: null,
      schema: { type: 'number', minimum: 0, maximum: 1, default: null },
    },
    {
      name: 'logging',
      title: 'Logging',
      description: null,
      schema: { type: 'boolean', default: true },
    },
    {
      name: 'colours',
      title: 'Colours',
      description: null,
      schema: {
        type: 'multi_select',
        minItems: 1,
        maxItems: 2,
        options: [
          { value: 'r', title: 'Red', description: null },
          { value: 'g', title: 'Green', description: null },
          { value: 'b', title: null, description: null },
        ],
        default: ['r'],
        customField: null,
      },
    },
    {
      name: 'weird',
      title: 'Weird',
      description: null,
      schema: { type: 'unrecognized', typeName: '_hologram', raw: {} },
    },
  ],
};

describe('initialValues', () => {
  it('pre-fills from defaults and picks the right draft shape per field', () => {
    expect(initialValues(config)).toEqual({
      name: { kind: 'text', text: 'svc' },
      port: { kind: 'text', text: '3000' },
      ratio: { kind: 'text', text: '' },
      logging: { kind: 'boolean', checked: true },
      colours: { kind: 'multi_select', values: ['r'], custom: undefined },
      weird: { kind: 'unsupported' },
    });
    expect(initialValues(colour)).toEqual({
      question_0: { kind: 'single_select', selection: { kind: 'none' } },
    });
  });
});

describe('validate', () => {
  it('keeps an unselected question and an empty custom answer unanswered', () => {
    for (const selection of [
      { kind: 'none' as const },
      { kind: 'custom' as const, text: '' },
      { kind: 'custom' as const, text: '   ' },
    ]) {
      const values = {
        question_0: { kind: 'single_select' as const, selection },
      };
      expect(validate(colour, values)).toEqual({ question_0: 'Required' });
      expect(toContent(colour, values)).toEqual({});
      expect(validate({ ...colour, required: [] }, values)).toEqual({});
    }
  });

  it('refuses custom text when the question only allows offered options', () => {
    const plain = structuredClone(colour);
    const field = plain.properties[0]!.schema;
    if (field.type !== 'string') throw new Error('expected a single choice');
    field.customField = null;
    const values = {
      question_0: {
        kind: 'single_select' as const,
        selection: { kind: 'custom' as const, text: 'teal' },
      },
    };
    expect(validate(plain, values)).toEqual({
      question_0: 'Choose one of the offered choices',
    });
    expect(toContent(plain, values)).toEqual({});
  });

  it('passes a defaulted form', () => {
    expect(validate(config, initialValues(config))).toEqual({});
  });

  it('requires required fields but not optional or unrecognized ones', () => {
    const values = initialValues(config);
    values.name = { kind: 'text', text: '' };
    expect(validate(config, values)).toEqual({ name: 'Required' });
  });

  it('checks string length, and leaves pattern and format to the agent', () => {
    const values = initialValues(config);
    values.name = { kind: 'text', text: 'a' };
    expect(validate(config, values).name).toBe('At least 2 characters');
    values.name = { kind: 'text', text: 'toolong' };
    expect(validate(config, values).name).toBe('At most 5 characters');
    // `AB` fails the schema's `^[a-z]+$`, and `nope` is not an email. Neither
    // is this client's business: the agent enforces both, and an unbounded
    // agent-supplied regex has no place on the main thread.
    values.name = { kind: 'text', text: 'AB' };
    expect(validate(config, values)).toEqual({});
  });

  it('checks numbers, integers, and multi-select counts', () => {
    const values = initialValues(config);
    values.port = { kind: 'text', text: '80' };
    expect(validate(config, values).port).toBe('At least 1024');
    values.port = { kind: 'text', text: '3000.5' };
    expect(validate(config, values).port).toBe('Must be a whole number');
    values.port = { kind: 'text', text: 'x' };
    expect(validate(config, values).port).toBe('Not a number');
    values.port = { kind: 'text', text: '3000' };
    values.ratio = { kind: 'text', text: '2' };
    expect(validate(config, values).ratio).toBe('At most 1');
    values.ratio = { kind: 'text', text: '' };
    values.colours = {
      kind: 'multi_select',
      values: ['r', 'g', 'b'],
      custom: undefined,
    };
    expect(validate(config, values).colours).toBe('Choose at most 2');
    // Empty is "not answered": fine for an optional field, required otherwise.
    values.colours = { kind: 'multi_select', values: [], custom: undefined };
    expect(validate(config, values).colours).toBeUndefined();
    expect(validate({ ...config, required: ['colours'] }, values).colours).toBe(
      'Required'
    );
  });

  it('a select with a custom escape counts its custom text as an answer', () => {
    expect(
      validate(colour, {
        question_0: { kind: 'single_select', selection: { kind: 'none' } },
      })
    ).toEqual({ question_0: 'Required' });
    // Typing an answer instead of picking one satisfies the question, and -
    // for a multi-select - counts towards `minItems`.
    expect(
      validate(colour, {
        question_0: {
          kind: 'single_select',
          selection: { kind: 'custom', text: 'blue' },
        },
      })
    ).toEqual({});
    expect(
      validate(colour, {
        question_0: {
          kind: 'single_select',
          selection: { kind: 'option', value: 'Red' },
        },
      })
    ).toEqual({});
    const oneColour: ElicitationSchema = {
      ...config,
      required: [],
      properties: [
        {
          ...config.properties[4]!,
          schema: {
            ...(config.properties[4]!.schema as Extract<
              ElicitationSchema['properties'][number]['schema'],
              { type: 'multi_select' }
            >),
            minItems: 1,
            customField: 'colours_custom',
          },
        },
      ],
    };
    expect(
      validate(oneColour, {
        colours: { kind: 'multi_select', values: [], custom: 'teal' },
      })
    ).toEqual({});
  });

  it('refuses a value no option offered', () => {
    expect(
      validate(colour, {
        question_0: {
          kind: 'single_select',
          selection: { kind: 'option', value: 'Mauve' },
        },
      })
    ).toEqual({ question_0: 'Not one of the offered choices' });
  });
});

describe('toContent', () => {
  it('sends the choice under the property or the custom text under its key', () => {
    expect(
      toContent(colour, {
        question_0: {
          kind: 'single_select',
          selection: { kind: 'option', value: 'Red' },
        },
      })
    ).toEqual({ question_0: 'Red' });
    expect(
      toContent(colour, {
        question_0: {
          kind: 'single_select',
          selection: { kind: 'custom', text: 'blue' },
        },
      })
    ).toEqual({ question_0_custom: 'blue' });
  });

  it('types values and omits blanks and unsupported fields', () => {
    const values = initialValues(config);
    expect(toContent(config, values)).toEqual({
      name: 'svc',
      port: 3000,
      logging: true,
      colours: ['r'],
    });
  });
});
