import type { ElicitationSchema } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  describeContent,
  initialValues,
  looksSuspicious,
  toContent,
  validate,
} from './elicitation-form';

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
      port: { kind: 'number', text: '3000' },
      ratio: { kind: 'number', text: '' },
      logging: { kind: 'boolean', checked: true },
      colours: { kind: 'multi', values: ['r'], custom: '' },
      weird: { kind: 'unsupported' },
    });
    expect(initialValues(colour)).toEqual({
      question_0: { kind: 'choice', value: undefined, custom: '' },
    });
  });
});

describe('validate', () => {
  it('passes a defaulted form', () => {
    expect(validate(config, initialValues(config))).toEqual({});
  });

  it('requires required fields but not optional or unrecognized ones', () => {
    const values = initialValues(config);
    values.name = { kind: 'text', text: '' };
    expect(validate(config, values)).toEqual({ name: 'Required' });
  });

  it('checks string length, pattern, and format', () => {
    const values = initialValues(config);
    values.name = { kind: 'text', text: 'a' };
    expect(validate(config, values).name).toBe('At least 2 characters');
    values.name = { kind: 'text', text: 'toolong' };
    expect(validate(config, values).name).toBe('At most 5 characters');
    values.name = { kind: 'text', text: 'AB' };
    expect(validate(config, values).name).toBe(
      'Does not match the required format'
    );
    const email: ElicitationSchema = {
      ...config,
      required: [],
      properties: [
        {
          ...config.properties[0]!,
          schema: {
            ...(config.properties[0]!.schema as Extract<
              ElicitationSchema['properties'][number]['schema'],
              { type: 'string' }
            >),
            minLength: null,
            maxLength: null,
            pattern: null,
            format: 'email',
          },
        },
      ],
    };
    expect(validate(email, { name: { kind: 'text', text: 'nope' } }).name).toBe(
      'Not a valid email'
    );
  });

  it('skips a pattern that could run away, leaving it to the agent', () => {
    const risky: ElicitationSchema = {
      ...config,
      required: [],
      properties: [
        {
          ...config.properties[0]!,
          schema: {
            type: 'string',
            minLength: null,
            maxLength: null,
            pattern: '^(a+)+$',
            format: null,
            default: null,
            options: [],
            customField: null,
          },
        },
      ],
    };
    expect(validate(risky, { name: { kind: 'text', text: 'aaaaab' } })).toEqual(
      {}
    );
  });

  it('checks numbers, integers, and multi-select counts', () => {
    const values = initialValues(config);
    values.port = { kind: 'number', text: '80' };
    expect(validate(config, values).port).toBe('At least 1024');
    values.port = { kind: 'number', text: '3000.5' };
    expect(validate(config, values).port).toBe('Must be a whole number');
    values.port = { kind: 'number', text: 'x' };
    expect(validate(config, values).port).toBe('Not a number');
    values.port = { kind: 'number', text: '3000' };
    values.ratio = { kind: 'number', text: '2' };
    expect(validate(config, values).ratio).toBe('At most 1');
    values.ratio = { kind: 'number', text: '' };
    values.colours = { kind: 'multi', values: ['r', 'g', 'b'], custom: '' };
    expect(validate(config, values).colours).toBe('Choose at most 2');
    // Empty is "not answered": fine for an optional field, required otherwise.
    values.colours = { kind: 'multi', values: [], custom: '' };
    expect(validate(config, values).colours).toBeUndefined();
    expect(validate({ ...config, required: ['colours'] }, values).colours).toBe(
      'Required'
    );
  });

  it('a select with a custom escape takes a choice or custom text, never both', () => {
    expect(
      validate(colour, {
        question_0: { kind: 'choice', value: undefined, custom: '' },
      })
    ).toEqual({ question_0: 'Required' });
    expect(
      validate(colour, {
        question_0: { kind: 'choice', value: 'Red', custom: 'blue' },
      })
    ).toEqual({ question_0: 'Choose an option or type your own, not both' });
    expect(
      validate(colour, {
        question_0: { kind: 'choice', value: undefined, custom: 'blue' },
      })
    ).toEqual({});
    expect(
      validate(colour, {
        question_0: { kind: 'choice', value: 'Red', custom: '' },
      })
    ).toEqual({});
  });
});

describe('toContent', () => {
  it('sends the choice under the property or the custom text under its key', () => {
    expect(
      toContent(colour, {
        question_0: { kind: 'choice', value: 'Red', custom: '' },
      })
    ).toEqual({ question_0: 'Red' });
    expect(
      toContent(colour, {
        question_0: { kind: 'choice', value: undefined, custom: 'blue' },
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

describe('describeContent', () => {
  it('renders titles for choices and the custom text when it was used', () => {
    expect(describeContent(colour, { question_0: 'Red' })).toEqual([
      { label: 'Best colour', value: 'Red' },
    ]);
    expect(describeContent(colour, { question_0_custom: 'blue' })).toEqual([
      { label: 'Best colour', value: 'blue' },
    ]);
    expect(
      describeContent(config, {
        port: 8080,
        colours: ['r', 'b'],
        logging: false,
      })
    ).toEqual([
      { label: 'Port', value: '8080' },
      { label: 'Logging', value: 'false' },
      { label: 'Colours', value: 'Red, b' },
    ]);
  });
});

describe('looksSuspicious', () => {
  it('flags punycode hosts', () => {
    expect(looksSuspicious('https://xn--pple-43d.com/connect')).toBe(true);
    expect(looksSuspicious('https://agent.example.com/connect')).toBe(false);
  });
});
