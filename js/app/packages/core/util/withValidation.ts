import type { z } from 'zod';
import { type FunctionDefinition, type ServiceClient, Svc } from '../service';
import type { MaybeResult, ResultError } from './maybeResult';

type WithInvalidError<T extends Svc<any, any, any>> = T extends Svc<
  infer ErrorCodes,
  infer Functions,
  infer Services
>
  ? Svc<
      ErrorCodes | 'invalid',
      {
        [K in keyof Functions]: Functions[K] extends FunctionDefinition<
          infer E,
          infer Args,
          infer Result,
          infer Throws
        >
          ? FunctionDefinition<
              E | 'invalid',
              Args,
              Result,
              Throws extends Array<E> ? Array<E | 'invalid'> : ['invalid']
            >
          : Functions[K];
      },
      Services
    >
  : never;

function zodErrorToInvalidErrors(
  zodError: z.ZodError
): ResultError<'invalid'>[] {
  return zodError.errors.map((err) => ({
    code: 'invalid',
    message: err.message,
    arg: err.path.join('.'),
    fatal: true,
  }));
}

export function withValidation<T extends Svc<any, any, any>>(
  service: T,
  client: ServiceClient<T>
): ServiceClient<WithInvalidError<T>> {
  const newService = new Svc(service.state.def.description, service.state.def);

  // Add 'invalid' error to the service
  newService.err('invalid', { description: 'Invalid input', fatal: true });

  // Copy existing error codes
  Object.entries(service.state.errors).forEach(([code, options]) => {
    newService.err(code as any, options);
  });

  // Add 'invalid' error to all functions and update their throws
  Object.entries(service.state.functions).forEach(([name, funcDef]) => {
    const newThrows = funcDef.throws
      ? [...funcDef.throws, 'invalid']
      : ['invalid'];
    const newFuncDef = {
      ...funcDef,
      throws: newThrows,
    };
    newService.fn(name as any, newFuncDef as any);
  });

  // Create a new client with Zod validation
  const validatedClient = {} as ServiceClient<WithInvalidError<T>>;
  Object.entries<unknown>(client).forEach(([key, originalFunc]) => {
    if (typeof originalFunc === 'function') {
      (validatedClient as any)[key] = async (args: any) => {
        const funcDef = service.state.functions[key];
        if (funcDef && funcDef.args) {
          const parseResult = funcDef.args.safeParse(args);
          if (!parseResult.success) {
            return [zodErrorToInvalidErrors(parseResult.error), null];
          }
          args = parseResult.data;
        }

        try {
          const result = await originalFunc(args);
          if (Array.isArray(result) && result.length === 2) {
            return result as MaybeResult<any, any>;
          }
          return [null, result] as MaybeResult<any, any>;
        } catch (error) {
          const invalidError: ResultError<'invalid'> = {
            code: 'invalid',
            message:
              error instanceof Error
                ? error.message
                : 'Unexpected error occurred',
            fatal: true,
          };
          return [[invalidError], null];
        }
      };
    } else {
      (validatedClient as any)[key] = originalFunc;
    }
  });

  return validatedClient;
}
