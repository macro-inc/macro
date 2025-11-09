import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import { type ServiceClient, Svc } from '../service';
import { err, ok } from './maybeResult';
import { withValidation } from './withValidation';

// Define a sample service for testing
const sampleService = new Svc('Sample service')
  .err('notFound', { description: 'Resource not found' })
  .fn('getUser', {
    description: 'Get user by id',
    args: { id: z.number().int().positive() },
    result: { name: z.string(), age: z.number() },
    throws: ['notFound'],
  })
  .fn('createUser', {
    description: 'Create a new user',
    args: { name: z.string(), age: z.number().int().positive() },
    result: { id: z.number() },
  });

// Define a sample client implementation
const sampleClient: ServiceClient<typeof sampleService> = {
  getUser: vi.fn(async ({ id }) => {
    if (id === 1) {
      return ok({ name: 'John Doe', age: 30 });
    }
    return err('notFound', 'User not found');
  }) as any, // mock screws up the type
  createUser: vi.fn(async () => {
    return { id: 123 } as const;
  }),
};

const validatedClient = withValidation(sampleService, sampleClient);

test('pass valid input and return correct result', async () => {
  const [errors, result] = await validatedClient.getUser({ id: 1 });
  expect(errors).toBeNull();
  expect(result).toEqual({ name: 'John Doe', age: 30 });
});

test('return service-defined error for invalid resource', async () => {
  const [errors, result] = await validatedClient.getUser({ id: 999 });
  expect(errors).toEqual([{ code: 'notFound', message: 'User not found' }]);
  expect(result).toBeNull();
});

test('return "invalid" error for invalid input type', async () => {
  const [errors, result] = await validatedClient.getUser({
    id: 'not-a-number',
  } as any);
  expect(errors).toHaveLength(1);
  expect(errors?.[0].code).toBe('invalid');
  expect(errors?.[0].arg).toBe('id');
  expect(result).toBeNull();
});

test('return "invalid" error for out-of-range input', async () => {
  const [errors, result] = await validatedClient.getUser({ id: -1 });
  expect(errors).toHaveLength(1);
  expect(errors?.[0].code).toBe('invalid');
  expect(errors?.[0].arg).toBe('id');
  expect(result).toBeNull();
});

test('pass valid input for function without "throws"', async () => {
  const [errors, result] = await validatedClient.createUser({
    name: 'Jane Doe',
    age: 25,
  });
  expect(errors).toBeNull();
  expect(result).toEqual({ id: 123 });
});

test('return "invalid" error for invalid input in function without "throws"', async () => {
  const [errors, result] = await validatedClient.createUser({
    name: 'Jane Doe',
    age: -5,
  });
  expect(errors).toHaveLength(1);
  expect(errors?.[0].code).toBe('invalid');
  expect(errors?.[0].arg).toBe('age');
  expect(result).toBeNull();
});

test('handle unexpected errors and return them as "invalid"', async () => {
  const errorClient = {
    getUser: vi.fn(async () => {
      throw new Error('Unexpected error');
    }),
  };
  const errorValidatedClient = withValidation(
    sampleService,
    errorClient as any
  );

  const [errors, result] = await errorValidatedClient.getUser({ id: 1 });
  expect(errors).toHaveLength(1);
  expect(errors?.[0].code).toBe('invalid');
  expect(errors?.[0].message).toBe('Unexpected error');
  expect(result).toBeNull();
});
