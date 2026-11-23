import { match } from 'ts-pattern';
import { z } from 'zod';
import type { Catalog, Operation, Property, Schema } from './catalog';
import { MAX_ITEMS_INPUT } from './tools';

/**
 * A handle an input names, minted once the call has an SDK client:
 * `arguments` are its `byId` parameters, client excluded.
 */
export class HandleInput {
  constructor(
    readonly className: string,
    readonly arguments_: Readonly<Record<string, unknown>>
  ) {}
}

/** The id a reference names, including initiative links ending in `/projects/<id>/overview`. */
export function idFromReference(reference: string): string {
  const trimmed = reference.trim();
  if (!URL.canParse(trimmed)) return trimmed;
  const segments = new URL(trimmed).pathname.split('/').filter(Boolean);
  if (segments.at(-3) === 'projects' && segments.at(-1) === 'overview')
    return segments.at(-2) ?? trimmed;
  return segments.at(-1) ?? trimmed;
}

const DATE_TIME = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()])
  .transform((value) => new Date(value));

/**
 * Builds and caches the Zod validator for each operation's input from the
 * same catalog schemas its JSON Schema comes from. Handle references parse
 * to {@link HandleInput}s and dates to `Date`s.
 */
export class InputValidators {
  private readonly operations = new Map<string, z.ZodType>();
  private readonly definitions = new Map<string, z.ZodType>();

  constructor(private readonly catalog: Catalog) {}

  operation(operation: Operation): z.ZodType {
    const cached = this.operations.get(operation.name);
    if (cached) return cached;
    const shape: Record<string, z.ZodType> = {};
    if (operation.receiver.kind === 'handle')
      shape[operation.receiver.property] = this.handle(
        operation.receiver.class
      );
    for (const parameter of operation.parameters) {
      const schema = this.schema(parameter.schema);
      const value = parameter.rest ? z.array(schema) : schema;
      shape[parameter.name] = parameter.optional ? value.optional() : value;
    }
    if (operation.iterable)
      shape[MAX_ITEMS_INPUT] = z.int().min(1).max(200).optional();
    const validator = z.object(shape).strict();
    this.operations.set(operation.name, validator);
    return validator;
  }

  private schema(schema: Schema): z.ZodType {
    return match(schema)
      .returnType<z.ZodType>()
      .with({ type: 'string' }, () => z.string())
      .with({ type: 'number' }, () => z.number())
      .with({ type: 'boolean' }, () => z.boolean())
      .with({ type: 'null' }, () => z.null())
      .with({ type: 'json' }, () => z.unknown())
      .with({ type: 'literal' }, ({ value }) => z.literal(value))
      .with({ type: 'enum' }, ({ values }) =>
        z.union(values.map((value) => z.literal(value)))
      )
      .with({ type: 'array' }, ({ items }) => z.array(this.schema(items)))
      .with({ type: 'object' }, ({ properties, additional }) => {
        const object = z.object(this.shape(properties));
        return additional
          ? object.catchall(this.schema(additional))
          : object.strict();
      })
      .with({ type: 'union' }, ({ anyOf }) =>
        z.union(anyOf.map((member) => this.schema(member)))
      )
      .with({ type: 'date' }, () => DATE_TIME)
      .with({ type: 'handle' }, (handle) => this.handle(handle.class))
      .with({ type: 'ref' }, ({ name }) => z.lazy(() => this.definition(name)))
      .exhaustive();
  }

  private shape(properties: Readonly<Record<string, Property>>) {
    return Object.fromEntries(
      Object.entries(properties).map(([name, property]) => {
        const schema = this.schema(property.schema);
        return [name, property.optional ? schema.optional() : schema];
      })
    );
  }

  private definition(name: string): z.ZodType {
    const cached = this.definitions.get(name);
    if (cached) return cached;
    const definition = this.catalog.definitions[name];
    if (!definition) throw new Error(`unknown definition ${name}`);
    const schema = this.schema(definition);
    this.definitions.set(name, schema);
    return schema;
  }

  private handle(className: string): z.ZodType {
    const reference = this.catalog.handles[className];
    if (!reference) throw new Error(`unknown handle ${className}`);
    return match(reference)
      .returnType<z.ZodType>()
      .with({ kind: 'any' }, ({ subclasses }) =>
        z
          .object({
            kind: z.union(subclasses.map((subclass) => z.literal(subclass))),
            id: z.string().min(1),
          })
          .strict()
          .transform(({ kind, id }) => this.plainHandle(kind, id))
      )
      .with({ kind: 'byId' }, ({ parameters }) => {
        const read = parameters.flatMap((parameter) =>
          parameter.client ? [] : [parameter]
        );
        const [only] = read;
        if (only && read.length === 1 && only.schema.type === 'string')
          return z
            .string()
            .min(1)
            .transform(
              (value) =>
                new HandleInput(className, {
                  [only.name]: idFromReference(value),
                })
            );
        return z
          .object(
            this.shape(
              Object.fromEntries(
                read.map((parameter) => [parameter.name, parameter])
              )
            )
          )
          .strict()
          .transform((value) => new HandleInput(className, value));
      })
      .exhaustive();
  }

  /** A subclass of an abstract handle, whose reference is one plain id. */
  private plainHandle(className: string, id: string) {
    const reference = this.catalog.handles[className];
    const parameter =
      reference?.kind === 'byId'
        ? reference.parameters.find((candidate) => !candidate.client)
        : undefined;
    if (!parameter) throw new Error(`${className} has no plain reference`);
    return new HandleInput(className, {
      [parameter.name]: idFromReference(id),
    });
  }
}
