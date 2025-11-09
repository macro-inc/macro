import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { Svc } from '../service';
import { convertSvcToVertexAI, SchemaType } from './serviceToVertexAi';

describe('Basic functionality', () => {
  test('convert a simple service with one function', () => {
    const svc = new Svc('Test Service').fn('testFn', {
      description: 'Test function',
      args: { input: z.string().describe('Input string') },
      result: { output: z.number().describe('Output number') },
    });

    const result = convertSvcToVertexAI(svc);

    expect(result).toEqual({
      testFn: {
        name: 'testFn',
        description: 'Test function',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            input: { type: SchemaType.STRING, description: 'Input string' },
          },
          required: ['input'],
        },
        returns: {
          type: SchemaType.OBJECT,
          properties: {
            output: { type: SchemaType.NUMBER, description: 'Output number' },
          },
          required: ['output'],
        },
      },
    });
  });

  test('a service with no functions', () => {
    const svc = new Svc('Empty Service');
    const result = convertSvcToVertexAI(svc);
    expect(result).toEqual({});
  });
});

describe('Access control', () => {
  test('exclude functions not accessible to AI', () => {
    const svc = new Svc('Service with access control')
      .fn('aiFunction', {
        description: 'AI can access this',
        args: { input: z.string() },
      })
      .fn('userOnlyFunction', {
        description: 'AI cannot access this',
        args: { input: z.string() },
        access: { only: ['user'] },
      });

    const result = convertSvcToVertexAI(svc);

    expect(result).toHaveProperty('aiFunction');
    expect(result).not.toHaveProperty('userOnlyFunction');
  });

  test('exclude entire service if AI is excluded', () => {
    const svc = new Svc('AI excluded service', {
      access: { exclude: ['ai'] },
    }).fn('someFunction', {
      description: 'Some function',
      args: { input: z.string() },
    });

    const result = convertSvcToVertexAI(svc);

    expect(result).toEqual({});
  });
});

describe('Nested services', () => {
  test('nested services', () => {
    const nestedSvc = new Svc('Nested Service').fn('nestedFn', {
      description: 'Nested function',
      args: { input: z.number() },
    });

    const mainSvc = new Svc('Main Service')
      .fn('mainFn', {
        description: 'Main function',
        args: { input: z.string() },
      })
      .use('nested', nestedSvc);

    const result = convertSvcToVertexAI(mainSvc);

    expect(result).toHaveProperty('mainFn');
    expect(result).toHaveProperty('nested');
    expect(result.nested).toHaveProperty('nestedFn');
  });
});

describe('Zod types', () => {
  test('Zod enums', () => {
    const MyEnum = z.enum(['Value1', 'Value2', 'Value3']);

    const svc = new Svc('Enum Service').fn('enumFn', {
      description: 'Enum function',
      args: { enumArg: MyEnum },
      result: { enumResult: MyEnum },
    });

    const result = convertSvcToVertexAI(svc);

    expect(result.enumFn.parameters.properties.enumArg).toEqual({
      type: SchemaType.STRING,
      enum: ['Value1', 'Value2', 'Value3'],
    });
    expect(result.enumFn.returns.properties.enumResult).toEqual({
      type: SchemaType.STRING,
      enum: ['Value1', 'Value2', 'Value3'],
    });
  });

  test('optional fields', () => {
    const svc = new Svc('Optional Fields Service').fn('optionalFn', {
      description: 'Function with optional field',
      args: {
        required: z.string(),
        optional: z.number().optional(),
        nullable: z.boolean().nullable(),
        requiredNullable: z.string().nullable(),
      },
    });

    const result = convertSvcToVertexAI(svc);

    expect(result.optionalFn.parameters).toEqual({
      type: SchemaType.OBJECT,
      properties: {
        required: { type: SchemaType.STRING },
        optional: { type: SchemaType.NUMBER, nullable: true },
        nullable: { type: SchemaType.BOOLEAN, nullable: true },
        requiredNullable: { type: SchemaType.STRING, nullable: true },
      },
      required: ['required'],
    });
  });

  test('arrays', () => {
    const svc = new Svc('Array Service').fn('arrayFn', {
      description: 'Function with array',
      args: { arrayArg: z.array(z.string()) },
    });

    const result = convertSvcToVertexAI(svc);

    expect(result.arrayFn.parameters.properties.arrayArg).toEqual({
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    });
  });

  test('nested objects', () => {
    const svc = new Svc('Nested Object Service').fn('nestedObjFn', {
      description: 'Function with nested object',
      args: {
        nestedObj: z.object({
          field1: z.string(),
          field2: z.number(),
        }),
      },
    });

    const result = convertSvcToVertexAI(svc);

    expect(result.nestedObjFn.parameters.properties.nestedObj).toEqual({
      type: SchemaType.OBJECT,
      properties: {
        field1: { type: SchemaType.STRING },
        field2: { type: SchemaType.NUMBER },
      },
      required: ['field1', 'field2'],
    });
  });
});

describe('Error handling', () => {
  test('throw error for unhandled Zod types', () => {
    const svc = new Svc('Unhandled Type Service').fn('unhandledTypeFn', {
      description: 'Function with unhandled type',
      args: { date: z.date() },
    });

    expect(() => convertSvcToVertexAI(svc)).toThrow(
      'Unhandled Zod type: ZodDate'
    );
  });
});

describe('MaybeResult handling', () => {
  test('MaybeResult return type', () => {
    const svc = new Svc('MaybeResult Service')
      .err('ERROR_1', { description: 'This is error 1' })
      .err('ERROR_2', { description: 'This is error 2' })
      .fn('maybeResultFn', {
        description: 'Function with MaybeResult',
        args: { input: z.string().describe('Input string') },
        result: { output: z.string().describe('Output string') },
        throws: ['ERROR_1', 'ERROR_2'],
      });

    const result = convertSvcToVertexAI(svc);

    expect(result.maybeResultFn.returns).toEqual({
      type: SchemaType.OBJECT,
      properties: {
        output: {
          type: SchemaType.STRING,
          description: 'Output string',
        },
      },
      required: ['output'],
    });

    expect(result.maybeResultFn.parameters).toEqual({
      type: SchemaType.OBJECT,
      properties: {
        input: {
          type: SchemaType.STRING,
          description: 'Input string',
        },
      },
      required: ['input'],
    });
  });
});

describe('Modifies flag', () => {
  test('include modifies flag when present', () => {
    const svc = new Svc('Modifies Service').fn('modifyingFn', {
      description: 'Function that modifies data',
      args: { input: z.string() },
      modifies: true,
    });

    const result = convertSvcToVertexAI(svc);

    expect(result.modifyingFn.modifies).toBe(true);
  });

  test('exclude modifies flag when not present', () => {
    const svc = new Svc('Non-modifying Service').fn('nonModifyingFn', {
      description: 'Function that does not modify data',
      args: { input: z.string() },
    });

    const result = convertSvcToVertexAI(svc);

    expect(result.nonModifyingFn).not.toHaveProperty('modifies');
  });
});
