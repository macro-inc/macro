import { match } from 'ts-pattern';
import type { Catalog, HandleReference, Property, Schema } from './catalog';

/** A JSON Schema object, as MCP's `inputSchema` carries it. */
export type JsonSchema = { [key: string]: JsonValue };
type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Converts catalog schemas to JSON Schema, collecting the definitions they
 * reference so a tool can carry them in its `$defs`.
 */
export class JsonSchemaWriter {
  private readonly used = new Set<string>();

  constructor(private readonly catalog: Catalog) {}

  /** The definitions written so far, and the ones they reference. */
  definitions(): JsonSchema {
    const written: JsonSchema = {};
    const pending = [...this.used];
    while (pending.length) {
      const name = pending.pop();
      if (name === undefined || name in written) continue;
      const definition = this.catalog.definitions[name];
      if (!definition) throw new Error(`unknown definition ${name}`);
      const before = new Set(this.used);
      written[name] = this.schema(definition);
      for (const added of this.used)
        if (!before.has(added)) pending.push(added);
    }
    return Object.fromEntries(
      Object.entries(written).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    );
  }

  schema(schema: Schema): JsonSchema {
    return match(schema)
      .with({ type: 'string' }, () => ({ type: 'string' }))
      .with({ type: 'number' }, () => ({ type: 'number' }))
      .with({ type: 'boolean' }, () => ({ type: 'boolean' }))
      .with({ type: 'null' }, () => ({ type: 'null' }))
      .with({ type: 'json' }, () => ({}))
      .with({ type: 'literal' }, ({ value }) => ({ const: value }))
      .with({ type: 'enum' }, ({ values }) => ({ enum: [...values] }))
      .with({ type: 'array' }, ({ items }) => ({
        type: 'array',
        items: this.schema(items),
      }))
      .with({ type: 'object' }, ({ properties, additional }) =>
        this.object(properties, additional)
      )
      .with({ type: 'union' }, ({ anyOf }) => ({
        anyOf: anyOf.map((member) => this.schema(member)),
      }))
      .with({ type: 'date' }, () => ({
        type: 'string',
        format: 'date-time',
        description: 'ISO 8601 date-time.',
      }))
      .with({ type: 'handle' }, (handle) => this.handle(handle.class))
      .with({ type: 'ref' }, ({ name }) => {
        this.used.add(name);
        return { $ref: `#/$defs/${name}` };
      })
      .exhaustive();
  }

  object(
    properties: Readonly<Record<string, Property>>,
    additional?: Schema
  ): JsonSchema {
    const written: JsonSchema = {};
    const required: string[] = [];
    for (const [name, property] of Object.entries(properties)) {
      written[name] = this.property(property);
      if (!property.optional) required.push(name);
    }
    return {
      type: 'object',
      properties: written,
      ...(required.length ? { required } : {}),
      additionalProperties: additional ? this.schema(additional) : false,
    };
  }

  property(property: Property): JsonSchema {
    const schema = this.schema(property.schema);
    if (!property.description) return schema;
    // `$ref` siblings are ignored by older drafts; wrap to keep the description.
    return '$ref' in schema
      ? { allOf: [schema], description: property.description }
      : { ...schema, description: property.description };
  }

  /** A handle reference: an id or Macro URL, or the ids its `byId` takes. */
  handle(name: string): JsonSchema {
    const reference = this.catalog.handles[name];
    if (!reference) throw new Error(`unknown handle ${name}`);
    return match<HandleReference, JsonSchema>(reference)
      .with({ kind: 'any' }, ({ subclasses }) => ({
        type: 'object',
        description: `Any of: ${subclasses.join(', ')}.`,
        properties: {
          kind: { enum: [...subclasses] },
          id: { type: 'string', description: 'Its id or Macro URL.' },
        },
        required: ['kind', 'id'],
        additionalProperties: false,
      }))
      .with({ kind: 'byId' }, ({ parameters }): JsonSchema => {
        const read = parameters.flatMap((parameter) =>
          parameter.client ? [] : [parameter]
        );
        const [only] = read;
        if (only && read.length === 1 && only.schema.type === 'string')
          return {
            type: 'string',
            description: `${name} id or Macro URL.`,
          };
        const object = this.object(
          Object.fromEntries(
            read.map((parameter) => [parameter.name, parameter])
          )
        );
        const described: JsonSchema = {
          ...object,
          description: `A ${name}, by the ids that locate it.`,
        };
        return described;
      })
      .exhaustive();
  }
}
