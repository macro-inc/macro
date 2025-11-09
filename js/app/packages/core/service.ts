import { z } from 'zod';
import type { FlattenObject } from './util/flatten';
import type { MaybeError, MaybeResult } from './util/maybeResult';

type ErrorDef = {
  code: string;
  description?: string;
  fatal?: true;
};

/**
 * Defines the types of actors that can interact with the service.
 */
export const ACTORS = {
  user: 'Human users of a service, acted upon through UI',
  ai: 'Chat or other AI users of a service that act on behalf of the user',
  producer: 'The block that produced the block can access these services',
} as const;

/**
 * Represents the type of an actor in the system.
 */
export type Actor = keyof typeof ACTORS;

/**
 * Access controls should be used sparingly. If there are functions or services
 * that behave similarly but have different access, consider breaking up or
 * consolidating the functionality first.
 */
export type Access =
  | {
      /** access is solely denied to actors specified */
      exclude?: Actor[];
    }
  | {
      /** access is solely permitted to actors specified */
      only?: Actor[];
    };

/**
 * INTERNAL USE ONLY.
 *
 * Defines the structure of a function in the service.
 * @template ErrorCodes - The possible error codes that the function can throw.
 * @template Args - The Zod schema for the function's arguments.
 * @template Result - The Zod schema for the function's result.
 * @template Throws - An array of possible error codes that the function can throw.
 */
export interface FunctionDefinition<
  ErrorCodes extends string = never,
  Args extends z.ZodRawShape | undefined = undefined,
  Result extends z.ZodRawShape | undefined = undefined,
  Throws extends
    | Array<ErrorCodes extends never ? never : ErrorCodes>
    | undefined = undefined,
> {
  /**
   * A description of the behavior of the function in regards to the
   * arguments (args) and result of the function. Use cases and other meta
   * information belongs here. This allows implementers, clients, and AI to
   * have a shared understanding.
   *
   * Argument names and types that closely correspond or exactly match
   * results allow functions to be chained by AI:
   * { userId: number } => { username: string }
   * { username: string } => { pinned: string [] }
   * Having `userId` will then allow the AI to access `pinned`.
   */
  description: string;
  /**
   * Arguments/inputs of the function, defined using Zod.
   *
   * Further description of each argument can be done using `.describe` on the
   * Zod type: https://zod.dev/?id=describe
   *
   * Example:
   * { content: z.string()
   *             .describe("The content of the entire document as HTML")
   * }
   */
  args?: Args;
  /**
   * Result/output of the function, defined using Zod.
   *
   * Further description of each argument can be done using `.describe` on the
   * Zod type: https://zod.dev/?id=describe
   *
   * Example:
   * { content: z.string()
   *             .describe("The content of the entire document as HTML")
   * }
   */
  result?: Result;
  /**
   * An array of error codes (defined on the service) that can be thrown by
   * this function.
   */
  throws?: Throws;
  /**
   * Indicates this function modifies data in some way that a view-only client
   * should not be able to.
   */
  modifies?: true;
  /**
   * The optional access controls for this function. This should be used sparingly.
   * Refer to the Access type for more info.
   * Service level access controls override function level access controls, so
   * these should be even more rare than service level access controls.
   */
  access?: Access;
}

export interface SvcDefinition {
  /**
   * A description of the overall functionality this service represents.
   * Use cases by user/AI/blocks or examples of inter-service behavior should be
   * provided here, with specific details described at the function level.
   */
  description: string;
  /**
   * Indicates that all functions in this service modifies data in some way
   * that a view-only client should not be able to.
   * Propogates downward to functions of this service and services used.
   */
  modifies?: true;
  /**
   * The optional access controls for this service. This should be used sparingly.
   * Refer to the Access type for more info.
   * Propogates downward to functions of this service and services used.
   */
  access?: Access;
}

type SvcState<E extends string, F extends string, S extends string> = {
  def: SvcDefinition;
  errors: Record<E, ErrorDef>;
  functions: Record<F, FunctionDefinition<E, any, any, any>>;
  services: Record<S, Svc<any, any, any>>;
};

/**
 * This provides a service builder that is strongly typed for clients and can be
 * used to build OpenAPI scheams, JSON schemas, or validate inputs.
 **/
export class Svc<
  ErrorCodes extends string = never,
  Functions extends Record<
    string,
    FunctionDefinition<ErrorCodes, any, any, any>
  > = {},
  Services extends Record<string, Svc<any, any, any>> = {},
> {
  public state: SvcState<
    ErrorCodes,
    keyof Functions & string,
    keyof Services & string
  > = {
    errors: {} as any,
    functions: {} as any,
    services: {} as any,
    def: {} as any,
  };

  constructor(description: string, def?: Omit<SvcDefinition, 'description'>) {
    this.state.def = {
      description,
      ...def,
    };
  }

  /**
   * Registers an error code that's used in this service
   *
   * @param code - Unique error code
   * @param description - Optional error description
   *
   * @example
   * myService.err('NOT_FOUND', 'Resource not found');
   */
  err<NewE extends string>(
    this: Svc<ErrorCodes, Functions, Services>,
    code: NewE extends ErrorCodes ? never : NewE,
    options?: { description?: string; fatal?: true }
  ): Svc<ErrorCodes | NewE, Functions, Services> {
    this.state.errors[code as unknown as ErrorCodes] = {
      code,
      ...options,
    };
    return this as any;
  }

  /**
   * Registers a new function for the service.
   *
   * @param name - Unique function name
   * @param def - Function definition object
   * @throws Type error if the function name is already defined or if throws contains undefined error codes
   *
   * @example
   * myService.fn('getUser', { throws: ['NOT_FOUND'] });
   */
  fn<
    NewF extends string,
    Args extends z.ZodRawShape | undefined = undefined,
    Result extends z.ZodRawShape | undefined = undefined,
    const Throws extends Array<ErrorCodes> | undefined = undefined,
  >(
    this: Svc<ErrorCodes, Functions, Services>,
    name: NewF extends keyof (Functions & Services) ? never : NewF,
    def: FunctionDefinition<ErrorCodes, Args, Result, Throws>
  ): Svc<
    ErrorCodes,
    FlattenObject<
      Functions & {
        [K in NewF]: FunctionDefinition<ErrorCodes, Args, Result, Throws>;
      }
    >,
    Services
  > {
    this.state.functions[name as unknown as keyof Functions & string] = {
      description: def.description,
      modifies: def.modifies ?? this.state.def.modifies,
      access: def.access ?? this.state.def.access,
      args: def.args ? z.object(def.args) : undefined,
      result: def.result ? z.object(def.result) : undefined,
      throws: def.throws,
    };
    return this as any;
  }

  use<NewS extends string, S extends Svc<any, any, any>>(
    this: Svc<ErrorCodes, Functions, Services>,
    name: NewS extends keyof (Functions & Services) ? never : NewS,
    service: S
  ): Svc<
    ErrorCodes | (S extends Svc<infer E, any, any> ? E : never),
    Functions,
    FlattenObject<Services & { [K in NewS]: S }>
  > {
    this.state.services[name] = service;
    return this as any;
  }
}

type ZodShapeToType<T extends z.ZodRawShape | undefined> =
  T extends z.ZodRawShape ? z.infer<z.ZodObject<T>> : undefined;

type ClientFunctionArgs<T> = T extends FunctionDefinition<
  any,
  infer Args,
  any,
  any
>
  ? ZodShapeToType<Args>
  : never;

type ClientFunctionResult<T> = T extends FunctionDefinition<
  any,
  any,
  infer Result,
  infer Throws
>
  ? Result extends z.ZodRawShape
    ? Throws extends string[]
      ? MaybeResult<Throws[number], ZodShapeToType<Result>>
      : ZodShapeToType<Result>
    : Throws extends string[]
      ? MaybeError<Throws[number]>
      : void
  : never;

export type ClientFunction<T extends FunctionDefinition<any, any, any, any>> =
  ClientFunctionArgs<T> extends undefined
    ? () => Promise<ClientFunctionResult<T>>
    : (args: ClientFunctionArgs<T>) => Promise<ClientFunctionResult<T>>;

type ClientFunctions<
  T extends Record<string, FunctionDefinition<any, any, any, any>>,
> = {
  [K in keyof T]: ClientFunction<T[K]>;
};
type ClientServices<T extends Record<string, Svc<any, any, any>>> = {
  [K in keyof T]: ServiceClient<T[K]>;
};

type OmitEmptyObjects<T> = {
  [K in keyof T as T[K] extends Record<string, never> ? never : K]: T[K];
};

export type ServiceClient<T extends Svc<any, any, any>> = T extends Svc<
  any,
  infer F,
  infer S
>
  ? FlattenObject<ClientFunctions<F> & OmitEmptyObjects<ClientServices<S>>>
  : never;

/**
 * Defines common fetch errors that can occur during API requests.
 */
export const fetchErrorsSvc = new Svc('Common fetch errors')
  .err('NETWORK_ERROR', { description: 'Network error occurred' })
  .err('HTTP_ERROR', { description: 'HTTP error occurred' })
  .err('NOT_FOUND', { description: 'Resource not found' })
  .err('UNAUTHORIZED', { description: 'Unauthorized access' })
  .err('SERVER_ERROR', { description: 'Internal server error' })
  .err('INVALID_JSON', { description: 'Invalid JSON in response' })
  .err('UNKNOWN_ERROR', { description: 'An unknown error occurred' })
  .err('GRAPHQL_ERROR', { description: 'GraphQL error occurred' })
  .err('GONE', { description: 'Resource deleted' });

export type FetchError = keyof typeof fetchErrorsSvc.state.errors;

export const fetchErrors = Object.keys(fetchErrorsSvc.state.errors) as Array<
  keyof typeof fetchErrorsSvc.state.errors
>;

/**
 * Combines specific errors with common fetch errors.
 * @param specificErrors - Additional specific errors to include.
 * @returns An array of error codes including both specific and fetch errors.
 */
export function withFetchErrors<const T extends string>(
  ...specificErrors: T[] | []
): (T | FetchError)[] {
  return [...specificErrors, ...fetchErrors];
}

type NonNullableShape<T extends z.ZodTypeAny> = T extends
  | z.ZodOptional<infer U>
  // biome-ignore lint/suspicious/noRedeclare: type reduction
  | z.ZodNullable<infer U>
  ? NonNullableShape<U>
  : T extends z.ZodObject<infer Shape>
    ? Shape
    : T;

/**
 * Extracts the non-nullable shape of a Zod schema.
 * @param schema - The Zod schema to process.
 * @returns The non-nullable shape of the schema.
 */
export function nonNullShape<T extends z.ZodTypeAny>(
  schema: T
): NonNullableShape<T> {
  let currentSchema: z.ZodTypeAny = schema;

  // Unwrap optional and nullable types
  while (
    currentSchema instanceof z.ZodOptional ||
    currentSchema instanceof z.ZodNullable
  ) {
    currentSchema = currentSchema.unwrap();
  }

  // Handle intersection types by merging their shapes
  if (currentSchema instanceof z.ZodIntersection) {
    const leftShape = nonNullShape(currentSchema._def.left);
    const rightShape = nonNullShape(currentSchema._def.right);
    return { ...leftShape, ...rightShape };
  }

  // Handle union types by merging all possible shapes
  if (currentSchema instanceof z.ZodUnion) {
    return currentSchema._def.options.map(nonNullShape);
  }

  // Extract object shapes
  if (currentSchema instanceof z.ZodObject) {
    return currentSchema.shape;
  }

  return currentSchema as NonNullableShape<T>;
}

export function asRawShape<T extends z.ZodTypeAny>(schema: T): z.ZodRawShape {
  let currentSchema: z.ZodTypeAny = schema;

  // Unwrap optional and nullable types
  while (
    currentSchema instanceof z.ZodOptional ||
    currentSchema instanceof z.ZodNullable
  ) {
    currentSchema = currentSchema.unwrap();
  }

  // Handle intersection types by merging their shapes
  if (currentSchema instanceof z.ZodIntersection) {
    const leftShape = asRawShape(currentSchema._def.left);
    const rightShape = asRawShape(currentSchema._def.right);
    return { ...leftShape, ...rightShape };
  }

  // Handle union types by finding a common raw shape
  if (currentSchema instanceof z.ZodUnion) {
    const options = currentSchema._def.options.map(asRawShape);
    return options.reduce((acc: any, shape: any) => ({ ...acc, ...shape }), {});
  }

  // Extract object shapes
  if (currentSchema instanceof z.ZodObject) {
    return currentSchema.shape;
  }

  throw new Error('Schema does not have a raw shape');
}
