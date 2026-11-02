import { createRequire } from 'node:module';
import ts from 'typescript';
import { expect, it } from 'vitest';
import type { ZodObject, ZodString } from 'zod/v3';
import { deferZodSchemaConstruction } from './lazy-zod-schema-codegen';

it('constructs only selected schemas once and retains the real object validation API', () => {
  const source = `
    import { z } from 'zod/v3';
    let calls = 0;
    function construct() { calls++; return z.object({ value: z.string() }).describe('boundary'); }
    export function constructions() { return calls; }
    export const First = construct();
    export const Second = construct();
  `;
  const javascript = ts.transpile(deferZodSchemaConstruction(source), {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ESNext,
  });
  const exports: {
    constructions(): number;
    getFirstSchema(): ZodObject<{ value: ZodString }>;
    getSecondSchema(): ZodObject<{ value: ZodString }>;
  } = new Function('require', `const exports = {}; ${javascript}; return exports;`)(createRequire(import.meta.url));
  expect(exports.constructions()).toBe(0);
  const first = exports.getFirstSchema();
  expect(first.safeParse({ value: 3 }).success).toBe(false);
  expect(first.omit({ value: true }).parse({})).toEqual({});
  expect(first.description).toBe('boundary');
  expect(exports.getFirstSchema()).toBe(first);
  expect(exports.constructions()).toBe(1);
  expect(exports.getSecondSchema()).not.toBe(first);
  expect(exports.constructions()).toBe(2);
});

it('constructs referenced schemas on demand without changing bounds or property names', () => {
  const source = `
    import { z } from 'zod/v3';
    export const minimum = 2;
    export const child = z.object({ child: z.string().min(minimum) });
    export const parent = z.object({ child: child, count: z.number().min(minimum) });
  `;
  const emitted = deferZodSchemaConstruction(source);
  expect(deferZodSchemaConstruction(emitted)).toBe(emitted);
  const javascript = ts.transpile(emitted, { module: ts.ModuleKind.CommonJS });
  const exports: {
    minimum: number;
    getChildSchema(): ZodObject<{ child: ZodString }>;
    getParentSchema(): ZodObject<{ child: ZodObject<{ child: ZodString }> }>;
  } = new Function('require', `const exports = {}; ${javascript}; return exports;`)(createRequire(import.meta.url));
  expect(exports.minimum).toBe(2);
  expect(exports.getParentSchema().shape.child).toBe(exports.getChildSchema());
  expect(exports.getParentSchema().safeParse({ child: { child: 'x' }, count: 2 }).success).toBe(false);
  expect(exports.getParentSchema().safeParse({ child: { child: 'xx' }, count: 2 }).success).toBe(true);
  expect(exports.getParentSchema().omit({ child: true }).parse({ count: 3 })).toEqual({ count: 3 });
});
