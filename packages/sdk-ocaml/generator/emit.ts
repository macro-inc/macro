/**
 * OpenAPI to OCaml, one service at a time. Every schema an operation uses is
 * lowered to an OCaml type (`O`): object schemas become records in the
 * service's `Types` module (with a `make_` constructor and JSON codecs),
 * string enums and unions become polymorphic variants, a 3.1 type array with
 * `null` becomes an option. Each operation becomes one function that builds
 * its request (path, query, headers, body) and decodes its success response.
 *
 * Anything this can't emit throws: no operation is ever skipped.
 */

import {
  docComment,
  ident,
  type Literal,
  moduleName,
  ocamlFloat,
  ocamlInt,
  ocamlString,
  percentEncode,
  RESERVED_TYPES,
  snake,
  tagOf,
  unique,
} from './names';
import type {
  Classification,
  JsonSchema,
  MediaContent,
  Spec,
  SpecOperation,
} from './spec';

// OCaml types

/**
 * A variant case: a literal, a constant object (a union member whose every
 * property is a literal, `{ action: 'approve' }`), or a payload. In a tagged
 * union, object and payload cases carry their tag field's value.
 */
type Case =
  | { tag: string; literal: Literal }
  | {
      tag: string;
      object: readonly (readonly [string, Literal])[];
      tagValue?: Literal;
    }
  | { tag: string; payload: O; tagValue?: Literal };

export type O =
  | { k: 'string' }
  | { k: 'int' }
  | { k: 'float' }
  | { k: 'bool' }
  /** JSON null. */
  | { k: 'unit' }
  /** An object without properties: `()`, sent as `{}`. */
  | { k: 'empty' }
  | { k: 'json' }
  | { k: 'list'; item: O }
  | { k: 'option'; item: O }
  | { k: 'assoc'; item: O }
  | { k: 'named'; name: string }
  | { k: 'variant'; cases: Case[]; tagKey?: string; strictInt?: boolean };

type Field = {
  ocaml: string;
  json: string;
  /** The field's OCaml type; an option when it may be absent or null. */
  type: O;
  /** Absent from the JSON when [None] (not required by the schema). */
  omit: boolean;
  /**
   * A required single-literal field (`kind: 'pdf'`): left out of the
   * record, written by the encoder and checked by the decoder.
   */
  constant?: Literal;
};

type Named =
  | { name: string; kind: 'record'; fields: Field[] }
  | { name: string; kind: 'alias'; type: O };

export type OperationEntry = {
  name: string;
  service: string;
  operationId: string;
  method: string;
  path: string;
  group: string;
  action: string;
  /** Its declared header parameters, lowercased (D1). */
  headers: string[];
  ocaml: string;
};

/** One sample call, for the request and decoder tests. */
export type CallFixture = {
  name: string;
  variant: 'required' | 'full';
  method: string;
  /** The concrete path the call must send (encoded), with the service prefix. */
  target: string;
  query: [string, string][];
  headers: [string, string][];
  body: null | {
    contentType: string;
    json?: unknown;
    text?: string;
    multipart?: true;
  };
  response: { status: number; contentType: string | null; body: string };
};

export type Stats = {
  operations: number;
  types: number;
  records: number;
  bodies: {
    total: number;
    typed: number;
    json: number;
    text: number;
    multipart: number;
    untyped: string[];
  };
  parameters: { total: number; typed: number; json: number };
  responses: {
    total: number;
    typed: number;
    json: number;
    text: number;
    unit: number;
    byStatus: number;
    untyped: string[];
  };
  /** Unions that can't be decoded reliably, typed Macro.Json.t. */
  unionFallbacks: string[];
  /** Schemas that allow any value ({} or an object without properties). */
  openSchemas: number;
};

const JSON_TYPES = ['application/json'];

// The per-service emitter

type Payload = {
  schema: JsonSchema;
  view: JsonSchema;
  tag?: string;
  tagValue?: Literal;
};

export function emitService(
  service: string,
  spec: Spec,
  ops: SpecOperation[],
  classify: (name: string) => Classification,
  stats: Stats
) {
  const components = spec.components?.schemas ?? {};
  const module = moduleName(service);
  const unitName = `macro_${snake(service)}`;
  const types = new Map<string, Named>();
  const typeNames = new Set<string>(RESERVED_TYPES);
  const componentType = new Map<string, string>();
  const pending: string[] = [];
  const componentByJson = new Map<string, string>();
  for (const [name, schema] of Object.entries(components))
    if (schema.properties) componentByJson.set(JSON.stringify(schema), name);

  const where = (context: string) => `${service}: ${context}`;

  function componentName(ref: string, context: string) {
    const prefix = '#/components/schemas/';
    if (!ref.startsWith(prefix))
      throw new Error(where(`${context}: unsupported $ref ${ref}`));
    const name = ref.slice(prefix.length);
    if (!components[name])
      throw new Error(where(`${context}: unknown schema ${name}`));
    return name;
  }

  function component(ref: string, context: string): JsonSchema {
    return components[componentName(ref, context)] as JsonSchema;
  }

  // Inspecting schemas: refs and allOf resolved.

  const merged = new WeakMap<JsonSchema, JsonSchema>();

  const ANNOTATIONS = new Set([
    'description',
    'title',
    'default',
    'deprecated',
    'example',
    'examples',
  ]);
  const annotationOnly = (schema: JsonSchema) =>
    Object.keys(schema).every((key) => ANNOTATIONS.has(key));

  function mergeAllOf(schema: JsonSchema, context: string): JsonSchema {
    const cached = merged.get(schema);
    if (cached) return cached;
    const { allOf, ...rest } = schema as JsonSchema & { allOf: JsonSchema[] };
    const members = allOf.filter((member) => !annotationOnly(member));
    if (!annotationOnly(rest)) members.push(rest);
    let out: JsonSchema;
    const [only] = members;
    if (members.length === 0) out = {};
    else if (members.length === 1 && only) out = only;
    else {
      const views = members.map((member) => view(member, context));
      const unions = views.filter((v) => v.oneOf || v.anyOf);
      if (unions.length > 1)
        throw new Error(where(`${context}: allOf of two unions`));
      const [union] = unions;
      if (union) {
        const others = members.filter((_, index) => views[index] !== union);
        const alternatives = (union.oneOf ?? union.anyOf) as JsonSchema[];
        out = {
          oneOf: alternatives.map((alternative) =>
            view(alternative, context).type === 'null'
              ? alternative
              : { allOf: [alternative, ...others] }
          ),
        };
      } else {
        const properties: Record<string, JsonSchema> = {};
        const required = new Set<string>();
        for (const v of views) {
          if (v.type !== 'object' && !v.properties)
            throw new Error(
              where(
                `${context}: allOf member is not an object: ${JSON.stringify(v).slice(0, 200)}`
              )
            );
          Object.assign(properties, v.properties ?? {});
          for (const key of (v.required as string[] | undefined) ?? [])
            required.add(key);
        }
        out = { type: 'object', properties, required: [...required] };
      }
    }
    merged.set(schema, out);
    return out;
  }

  function view(schema: JsonSchema, context: string, depth = 0): JsonSchema {
    if (depth > 50) throw new Error(where(`${context}: $ref cycle`));
    if (typeof schema.$ref === 'string')
      return view(component(schema.$ref, context), context, depth + 1);
    if (schema.allOf)
      return view(mergeAllOf(schema, context), context, depth + 1);
    return schema;
  }

  function typeList(schema: JsonSchema): string[] | undefined {
    const type = schema.type;
    if (type === undefined) return undefined;
    return Array.isArray(type) ? (type as string[]) : [type as string];
  }

  function nullable(schema: JsonSchema, context: string, seen = 0): boolean {
    if (seen > 20) return false;
    const v = view(schema, context);
    if (typeList(v)?.includes('null')) return true;
    if ((v.enum as Literal[] | undefined)?.includes(null)) return true;
    const members = (v.oneOf ?? v.anyOf) as JsonSchema[] | undefined;
    return !!members?.some((member) => nullable(member, context, seen + 1));
  }

  /** A required property whose value is one literal, by property name. */
  function constants(
    v: JsonSchema,
    context: string,
    depth = 0
  ): Map<string, Literal> {
    const out = new Map<string, Literal>();
    const alternatives = (v.oneOf ?? v.anyOf) as JsonSchema[] | undefined;
    if (alternatives) {
      // A union's constants: those every (non-null) alternative shares.
      if (depth > 10) return out;
      const each = alternatives
        .map((alternative) => view(alternative, context))
        .filter((alternative) => alternative.type !== 'null')
        .map((alternative) => constants(alternative, context, depth + 1));
      const [first, ...rest] = each;
      for (const [key, value] of first ?? [])
        if (rest.every((other) => other.has(key) && other.get(key) === value))
          out.set(key, value);
      return out;
    }
    const required = new Set((v.required as string[] | undefined) ?? []);
    for (const [key, property] of Object.entries(
      (v.properties ?? {}) as Record<string, JsonSchema>
    )) {
      if (!required.has(key)) continue;
      const p = view(property, context);
      if ('const' in p) out.set(key, p.const as Literal);
      else if (Array.isArray(p.enum) && p.enum.length === 1)
        out.set(key, p.enum[0] as Literal);
    }
    return out;
  }

  // Lowering

  const lowered = new WeakMap<JsonSchema, O>();

  function named(componentKey: string): O {
    let name = componentType.get(componentKey);
    if (!name) {
      name = unique(ident(componentKey), typeNames);
      componentType.set(componentKey, name);
      pending.push(componentKey);
    }
    return { k: 'named', name };
  }

  function lower(schema: JsonSchema, context: string): O {
    const cached = lowered.get(schema);
    if (cached) return cached;
    const out = lowerUncached(schema, context);
    lowered.set(schema, out);
    return out;
  }

  function isRecordSchema(v: JsonSchema) {
    const types = typeList(v);
    return (
      !v.oneOf &&
      !v.anyOf &&
      !v.enum &&
      (types === undefined || (types.length === 1 && types[0] === 'object')) &&
      !!v.properties &&
      Object.keys(v.properties as object).length > 0
    );
  }

  function record(v: JsonSchema, name: string, context: string) {
    if (
      v.additionalProperties &&
      v.additionalProperties !== true &&
      typeof v.additionalProperties === 'object'
    )
      throw new Error(
        where(
          `${context}: an object with both properties and additionalProperties`
        )
      );
    const entry: Named = { name, kind: 'record', fields: [] };
    types.set(name, entry);
    const required = new Set((v.required as string[] | undefined) ?? []);
    const constantFields = constants(v, context);
    const taken = new Set<string>();
    for (const [json, property] of Object.entries(
      v.properties as Record<string, JsonSchema>
    )) {
      const ocaml = unique(ident(json), taken);
      const type = lower(property, `${name}_${ocaml}`);
      const isRequired = required.has(json);
      const constant = constantFields.get(json);
      entry.fields.push({
        ocaml,
        json,
        type:
          isRequired || type.k === 'option'
            ? type
            : { k: 'option', item: type },
        omit: !isRequired,
        ...(constant !== undefined ? { constant } : {}),
      });
    }
    // A record needs a field: one of only constants keeps them.
    if (entry.fields.every((field) => field.constant !== undefined))
      for (const field of entry.fields) delete field.constant;
    return entry;
  }

  function inlineRecord(v: JsonSchema, context: string): O {
    const same = componentByJson.get(JSON.stringify(v));
    if (same) return named(same);
    const name = unique(ident(context), typeNames);
    record(v, name, context);
    return { k: 'named', name };
  }

  function literals(values: readonly Literal[]): Case[] {
    const taken = new Set<string>();
    return values.map((value) => ({
      tag: unique(tagOf(value), taken),
      literal: value,
    }));
  }

  function lowerUncached(schema: JsonSchema, context: string): O {
    if (typeof schema.$ref === 'string')
      return named(componentName(schema.$ref, context));
    if (schema.allOf) return lower(mergeAllOf(schema, context), context);
    if (schema.oneOf || schema.anyOf)
      return union((schema.oneOf ?? schema.anyOf) as JsonSchema[], context);
    const types = typeList(schema);
    if ('const' in schema)
      return { k: 'variant', cases: literals([schema.const as Literal]) };
    if (Array.isArray(schema.enum)) {
      const values = schema.enum as Literal[];
      const present = values.filter((value) => value !== null);
      const cases: O = { k: 'variant', cases: literals(present) };
      if (!present.length) return { k: 'unit' };
      return values.includes(null) || types?.includes('null')
        ? { k: 'option', item: cases }
        : cases;
    }
    if (types) {
      const nonNull = types.filter((type) => type !== 'null');
      if (nonNull.length < types.length) {
        if (!nonNull.length) return { k: 'unit' };
        if (nonNull.length > 1)
          return union(
            [...nonNull.map((type) => ({ ...schema, type })), { type: 'null' }],
            context
          );
        return {
          k: 'option',
          item: lower({ ...schema, type: nonNull[0] }, context),
        };
      }
      if (nonNull.length > 1)
        return union(
          nonNull.map((type) => ({ ...schema, type })),
          context
        );
      switch (nonNull[0]) {
        case 'string':
          return { k: 'string' };
        case 'integer':
          return { k: 'int' };
        case 'number':
          return { k: 'float' };
        case 'boolean':
          return { k: 'bool' };
        case 'array':
          if (!schema.items) {
            stats.openSchemas++;
            return { k: 'list', item: { k: 'json' } };
          }
          return {
            k: 'list',
            item: lower(schema.items as JsonSchema, `${context}_item`),
          };
        case 'object':
          break;
        default:
          throw new Error(where(`${context}: unsupported type ${nonNull[0]}`));
      }
    }
    // An object, or a schema without a type.
    if (isRecordSchema(schema)) return inlineRecord(schema, context);
    const additional = schema.additionalProperties;
    if (additional && typeof additional === 'object')
      return {
        k: 'assoc',
        item: lower(additional as JsonSchema, `${context}_value`),
      };
    if (types && additional === false) return { k: 'empty' };
    const known = Object.keys(schema).filter(
      (key) =>
        !ANNOTATIONS.has(key) &&
        ![
          'type',
          'properties',
          'additionalProperties',
          'required',
          'propertyNames',
          'format',
        ].includes(key)
    );
    if (known.length)
      throw new Error(
        where(
          `${context}: unsupported schema ${JSON.stringify(schema).slice(0, 300)}`
        )
      );
    stats.openSchemas++;
    return { k: 'json' };
  }

  type Kind =
    | 'string'
    | 'int'
    | 'float'
    | 'bool'
    | 'array'
    | 'object'
    | 'null'
    | 'any';

  function kinds(schema: JsonSchema, context: string, depth = 0): Set<Kind> {
    const v = view(schema, context);
    const out = new Set<Kind>();
    if (depth > 20) return new Set(['any']);
    const members = (v.oneOf ?? v.anyOf) as JsonSchema[] | undefined;
    if (members) {
      for (const member of members)
        for (const kind of kinds(member, context, depth + 1)) out.add(kind);
      return out;
    }
    if ('const' in v || Array.isArray(v.enum)) {
      for (const value of ('const' in v ? [v.const] : v.enum) as Literal[])
        out.add(
          value === null
            ? 'null'
            : typeof value === 'string'
              ? 'string'
              : typeof value === 'boolean'
                ? 'bool'
                : Number.isInteger(value)
                  ? 'int'
                  : 'float'
        );
      return out;
    }
    const types = typeList(v);
    if (!types)
      return new Set([
        v.properties || v.additionalProperties ? 'object' : 'any',
      ]);
    for (const type of types)
      out.add(
        (
          {
            string: 'string',
            integer: 'int',
            number: 'float',
            boolean: 'bool',
            array: 'array',
            object: 'object',
            null: 'null',
          } as Record<string, Kind>
        )[type] ?? 'any'
      );
    return out;
  }

  function kindTag(schema: JsonSchema, context: string): string {
    if (typeof schema.$ref === 'string')
      return moduleName(componentName(schema.$ref, context));
    const [kind] = [...kinds(schema, context)].filter((k) => k !== 'null');
    return (
      {
        string: 'String',
        int: 'Int',
        float: 'Float',
        bool: 'Bool',
        array: 'List',
        object: 'Object',
        any: 'Json',
        null: 'Null',
      } as Record<Kind, string>
    )[kind ?? 'any'];
  }

  function union(members: readonly JsonSchema[], context: string): O {
    const literalValues: Literal[] = [];
    const payloads: Payload[] = [];
    let isNullable = false;
    const flatten = (list: readonly JsonSchema[], depth: number) => {
      if (depth > 10)
        throw new Error(where(`${context}: unions nest too deep`));
      for (const member of list) {
        if (member.$ref) {
          const v = view(member, context);
          payloads.push({ schema: member, view: v });
          continue;
        }
        const m = member.allOf ? mergeAllOf(member, context) : member;
        // An allOf that distributes over a union stays one member (a nested
        // variant), so its alternatives' shared tag still tells it apart.
        if (member.allOf && (m.oneOf || m.anyOf)) {
          payloads.push({ schema: member, view: m });
          continue;
        }
        if (m.$ref) {
          payloads.push({ schema: m, view: view(m, context) });
          continue;
        }
        if (m.oneOf || m.anyOf) {
          flatten((m.oneOf ?? m.anyOf) as JsonSchema[], depth + 1);
          continue;
        }
        const types = typeList(m);
        if (types?.length === 1 && types[0] === 'null') {
          isNullable = true;
          continue;
        }
        if (types?.includes('null')) {
          isNullable = true;
          const rest = types.filter((type) => type !== 'null');
          flatten(
            rest.map((type) => ({ ...m, type })),
            depth + 1
          );
          continue;
        }
        if ('const' in m) {
          literalValues.push(m.const as Literal);
          continue;
        }
        if (Array.isArray(m.enum)) {
          for (const value of m.enum as Literal[])
            if (value === null) isNullable = true;
            else literalValues.push(value);
          continue;
        }
        if (types && types.length > 1) {
          flatten(
            types.map((type) => ({ ...m, type })),
            depth + 1
          );
          continue;
        }
        payloads.push({ schema: m, view: m });
      }
    };
    flatten(members, 0);
    const wrap = (o: O): O =>
      isNullable && o.k !== 'option' ? { k: 'option', item: o } : o;
    const [only] = payloads;
    if (!literalValues.length && payloads.length === 1 && only)
      return wrap(lower(only.schema, context));
    if (!literalValues.length && !payloads.length)
      return isNullable ? { k: 'unit' } : { k: 'json' };

    const fallback = (reason: string): O => {
      stats.unionFallbacks.push(`${service}: ${context}: ${reason}`);
      return wrap({ k: 'json' });
    };

    const taken = new Set<string>();
    const cases: Case[] = literals(literalValues);
    for (const c of cases) taken.add(c.tag);

    // Kinds must not overlap, except objects (told apart below) and an
    // integer with a number (an integer token is the integer).
    const objects = payloads.filter((p) =>
      kinds(p.schema, context).has('object')
    );
    const others = payloads.filter((p) => !objects.includes(p));
    const seenKinds = new Set<Kind>(literalValues.length ? [] : []);
    for (const payload of payloads) {
      const k = kinds(payload.schema, context);
      if (k.has('any')) return fallback('a member allows any value');
      if (k.has('object') && k.size > 1 && !(k.size === 2 && k.has('null')))
        return fallback('a member is both an object and something else');
    }
    for (const payload of others) {
      for (const kind of kinds(payload.schema, context)) {
        if (kind === 'null') continue;
        if (seenKinds.has(kind)) return fallback(`two members are ${kind}s`);
        seenKinds.add(kind);
      }
    }
    const strictInt = seenKinds.has('int') && seenKinds.has('float');

    // Objects: a tag field (the discriminator, or a required constant
    // property every member has with distinct values); else the required
    // fields each member has and later members don't declare.
    let tagKey: string | undefined;
    if (objects.length > 1) {
      const views = objects.map((p) => view(p.schema, context));
      const candidates = new Map<string, Literal[]>();
      const first = views[0]
        ? constants(views[0], context)
        : new Map<string, Literal>();
      for (const key of first.keys()) {
        const values = views.map((v) => constants(v, context).get(key));
        if (
          values.every((value) => value !== undefined) &&
          new Set(values).size === values.length
        )
          candidates.set(key, values as Literal[]);
      }
      const [found] = candidates.entries();
      if (found) {
        tagKey = found[0];
        objects.forEach((p, index) => {
          p.tagValue = found[1][index];
        });
      } else {
        // Most required fields first.
        const requiredOf = (v: JsonSchema) =>
          ((v.required as string[] | undefined) ?? []).filter((key) => {
            const property = (
              v.properties as Record<string, JsonSchema> | undefined
            )?.[key];
            return property && !nullable(property, context);
          });
        objects.sort(
          (a, b) =>
            requiredOf(view(b.schema, context)).length -
            requiredOf(view(a.schema, context)).length
        );
        for (let i = 0; i < objects.length; i++)
          for (let j = i + 1; j < objects.length; j++) {
            const earlier = view((objects[i] as Payload).schema, context);
            const later = view((objects[j] as Payload).schema, context);
            const laterProperties = new Set(
              Object.keys((later.properties ?? {}) as object)
            );
            if (!requiredOf(earlier).some((key) => !laterProperties.has(key)))
              return fallback(
                'object members without a tag field or distinguishing required fields'
              );
          }
      }
    }

    for (const payload of [...others, ...objects]) {
      const tag = unique(
        payload.tagValue !== undefined
          ? tagOf(payload.tagValue)
          : kindTag(payload.schema, context),
        taken
      );
      const v = view(payload.schema, context);
      const constantFields = isRecordSchema(v)
        ? constants(v, context)
        : new Map<string, Literal>();
      const properties = Object.keys((v.properties ?? {}) as object);
      if (
        isRecordSchema(v) &&
        !payload.schema.$ref &&
        constantFields.size === properties.length
      ) {
        cases.push({
          tag,
          object: [...constantFields.entries()],
          ...(payload.tagValue !== undefined
            ? { tagValue: payload.tagValue }
            : {}),
        });
        continue;
      }
      cases.push({
        tag,
        payload: lower(payload.schema, `${context}_${tag.toLowerCase()}`),
        ...(payload.tagValue !== undefined
          ? { tagValue: payload.tagValue }
          : {}),
      });
    }
    return wrap({
      k: 'variant',
      cases,
      ...(tagKey ? { tagKey } : {}),
      ...(strictInt ? { strictInt } : {}),
    });
  }

  function defineComponents() {
    while (pending.length) {
      const key = pending.shift() as string;
      const name = componentType.get(key) as string;
      const schema = components[key] as JsonSchema;
      const v = schema.allOf ? mergeAllOf(schema, key) : schema;
      if (!v.$ref && isRecordSchema(v)) record(v, name, key);
      else {
        // Seed, so a self-reference finds the name while lowering.
        const entry: Named = { name, kind: 'alias', type: { k: 'json' } };
        types.set(name, entry);
        entry.type = lower(v, name);
        if (entry.type.k === 'named' && entry.type.name === name)
          throw new Error(where(`${key} is an alias of itself`));
      }
    }
  }

  // Operations

  type Arg = {
    label: string;
    optional: boolean;
    /** The argument's OCaml type (for an optional one, without the option). */
    type: O;
    kind: 'path' | 'query' | 'header' | 'body';
    /** The parameter's name in the request. */
    wire: string;
  };

  type Body =
    | { kind: 'json'; contentType: string; type: O }
    | { kind: 'text'; contentType: string }
    | {
        kind: 'multipart';
        type: O;
        fields: {
          json: string;
          ocaml: string;
          binary: boolean;
          omit: boolean;
          type: O;
        }[];
      };

  type ResponseCase =
    | { status: number; kind: 'json'; type: O; schema: JsonSchema }
    | { status: number; kind: 'text'; contentType: string }
    | { status: number; kind: 'unit' };

  type Result =
    | { kind: 'single'; case: ResponseCase }
    | { kind: 'optional'; case: ResponseCase & { kind: 'json' } }
    | { kind: 'status'; cases: ResponseCase[] };

  type Built = {
    op: SpecOperation;
    name: string;
    args: Arg[];
    body?: Body;
    bodyRequired: boolean;
    result: Result;
    accept: string;
    ok: number[];
    doc: string;
  };

  function pickContent(
    content: MediaContent,
    context: string
  ): [string, JsonSchema | undefined] {
    const types = Object.keys(content);
    const json = types.find((type) => JSON_TYPES.includes(type));
    const chosen = json ?? (types.length === 1 ? types[0] : undefined);
    if (!chosen)
      throw new Error(
        where(
          `${context}: can't choose among content types ${types.join(', ')}`
        )
      );
    return [chosen, content[chosen]?.schema];
  }

  const built: Built[] = [];
  const valueNames = new Set<string>();

  function buildOperation(op: SpecOperation) {
    const context = op.operationId;
    const name = ident(op.operationId);
    if (valueNames.has(name))
      throw new Error(where(`two operations are named ${module}.${name}`));
    valueNames.add(name);
    const labels = new Set<string>(['body']);
    const args: Arg[] = [];
    const parameters = op.operation.parameters ?? [];
    for (const parameter of parameters) {
      if (!['path', 'query', 'header'].includes(parameter.in))
        throw new Error(
          where(
            `${op.name}: ${parameter.in} parameter ${parameter.name} is not supported`
          )
        );
      if (
        parameter.style &&
        parameter.style !== (parameter.in === 'query' ? 'form' : 'simple')
      )
        throw new Error(
          where(
            `${op.name}: parameter style ${parameter.style} is not supported`
          )
        );
      if (parameter.in === 'query' && parameter.explode === false)
        throw new Error(where(`${op.name}: explode: false is not supported`));
    }
    const placeholders = [...op.path.matchAll(/\{([^}]+)\}/g)].map(
      (match) => match[1] as string
    );
    const literalsOk = op.path
      .replace(/\{[^}]+\}/g, '')
      .match(/^[A-Za-z0-9\-._~/:@!$&'()*+,;=]*$/);
    if (!literalsOk)
      throw new Error(where(`${op.name}: path ${op.path} needs encoding`));
    const ordered = [
      ...placeholders.map((placeholder) => {
        const parameter = parameters.find(
          (p) => p.in === 'path' && p.name === placeholder
        );
        if (!parameter)
          throw new Error(
            where(`${op.name}: no parameter for {${placeholder}}`)
          );
        return parameter;
      }),
      ...parameters.filter((p) => p.in === 'query'),
      ...parameters.filter((p) => p.in === 'header'),
    ];
    for (const parameter of parameters)
      if (parameter.in === 'path' && !placeholders.includes(parameter.name))
        throw new Error(
          where(
            `${op.name}: path parameter ${parameter.name} is not in the path`
          )
        );
    for (const parameter of ordered) {
      const label = unique(ident(parameter.name), labels);
      if (!parameter.schema)
        throw new Error(
          where(`${op.name}: parameter ${parameter.name} has no schema`)
        );
      const type = lower(parameter.schema, `${context}_${label}`);
      checkParameterType(
        type,
        parameter.in === 'query',
        `${op.name}: parameter ${parameter.name}`
      );
      const required =
        parameter.in === 'path' ||
        (parameter.required === true && type.k !== 'option');
      stats.parameters.total++;
      if (type.k === 'json') stats.parameters.json++;
      else stats.parameters.typed++;
      args.push({
        label,
        optional: !required,
        type: !required && type.k === 'option' ? type.item : type,
        kind: parameter.in as Arg['kind'],
        wire: parameter.name,
      });
    }

    let body: Body | undefined;
    const requestBody = op.operation.requestBody;
    if (requestBody) {
      stats.bodies.total++;
      const [contentType, schema] = pickContent(
        requestBody.content,
        `${op.name} request`
      );
      if (JSON_TYPES.includes(contentType)) {
        if (!schema)
          throw new Error(where(`${op.name}: JSON body without a schema`));
        const type = lower(schema, `${context}_body`);
        body = { kind: 'json', contentType, type };
        if (type.k === 'json') {
          stats.bodies.json++;
          stats.bodies.untyped.push(
            `${op.name}: ${JSON.stringify(schema).slice(0, 120)}`
          );
        } else stats.bodies.typed++;
      } else if (contentType === 'multipart/form-data') {
        if (!schema)
          throw new Error(where(`${op.name}: multipart body without a schema`));
        const type = lower(schema, `${context}_body`);
        defineComponents();
        const entry = type.k === 'named' ? types.get(type.name) : undefined;
        if (entry?.kind !== 'record')
          throw new Error(where(`${op.name}: multipart body is not an object`));
        const v = view(schema, op.name);
        const fields = entry.fields.map((field) => {
          const property = view(
            (v.properties as Record<string, JsonSchema>)[
              field.json
            ] as JsonSchema,
            op.name
          );
          const inner =
            field.type.k === 'option' ? field.type.item : field.type;
          checkParameterType(
            inner,
            false,
            `${op.name}: multipart field ${field.json}`
          );
          return {
            json: field.json,
            ocaml: field.ocaml,
            binary: property.format === 'binary',
            omit: field.type.k === 'option',
            type: inner,
          };
        });
        body = { kind: 'multipart', type, fields };
        stats.bodies.multipart++;
      } else {
        body = { kind: 'text', contentType };
        stats.bodies.text++;
      }
    }

    // Success responses: the 2xx ones, else the declared 3xx ones.
    const codes = Object.keys(op.operation.responses);
    let success = codes.filter((code) => /^2\d\d$/.test(code));
    if (!success.length) success = codes.filter((code) => /^3\d\d$/.test(code));
    stats.responses.total++;
    let result: Result;
    let accept = '*/*';
    if (!success.length) {
      result = {
        kind: 'single',
        case: { status: 200, kind: 'text', contentType: '*/*' },
      };
      stats.responses.text++;
      stats.responses.untyped.push(
        `${op.name}: no responses declared, the body as a string`
      );
    } else {
      const cases: ResponseCase[] = success.map((code) => {
        const status = Number(code);
        const content = op.operation.responses[code]?.content;
        // A 204 reply has no body, whatever the spec says it contains.
        if (!content || !Object.keys(content).length || status === 204)
          return { status, kind: 'unit' };
        const [contentType, schema] = pickContent(
          content,
          `${op.name} response ${code}`
        );
        if (JSON_TYPES.includes(contentType)) {
          if (!schema) return { status, kind: 'text', contentType };
          return { status, kind: 'json', schema, type: { k: 'json' } };
        }
        return { status, kind: 'text', contentType };
      });
      const jsonCases = cases.filter(
        (c): c is ResponseCase & { kind: 'json' } => c.kind === 'json'
      );
      const texts = cases.filter((c) => c.kind === 'text');
      const units = cases.filter((c) => c.kind === 'unit');
      const sameSchema =
        new Set(jsonCases.map((c) => JSON.stringify(c.schema))).size <= 1;
      const lowerCase = (
        c: ResponseCase & { kind: 'json' },
        suffix: string
      ) => {
        c.type = lower(c.schema, `${context}_response${suffix}`);
        return c;
      };
      const [firstJson] = jsonCases;
      if (jsonCases.length && firstJson && sameSchema && !texts.length) {
        const c = lowerCase(firstJson, '');
        for (const other of jsonCases) other.type = c.type;
        result = units.length
          ? { kind: 'optional', case: c }
          : { kind: 'single', case: c };
        accept = 'application/json';
        if (c.type.k === 'json') {
          stats.responses.json++;
          stats.responses.untyped.push(
            `${op.name}: Macro.Json.t: ${JSON.stringify(c.schema).slice(0, 120)}`
          );
        } else stats.responses.typed++;
      } else if (
        !jsonCases.length &&
        texts.length &&
        !units.length &&
        new Set(texts.map((c) => c.kind === 'text' && c.contentType)).size === 1
      ) {
        const [c] = texts as (ResponseCase & { kind: 'text' })[];
        if (!c) throw new Error('unreachable');
        result = { kind: 'single', case: c };
        accept = c.contentType;
        stats.responses.text++;
      } else if (!jsonCases.length && !texts.length) {
        result = {
          kind: 'single',
          case: { status: Number(success[0]), kind: 'unit' },
        };
        stats.responses.unit++;
      } else {
        for (const c of jsonCases) lowerCase(c, `_${c.status}`);
        result = { kind: 'status', cases };
        accept = [
          ...new Set(
            cases.flatMap((c) =>
              c.kind === 'json'
                ? ['application/json']
                : c.kind === 'text'
                  ? [c.contentType]
                  : []
            )
          ),
        ].join(', ');
        stats.responses.byStatus++;
      }
    }
    const ok = success
      .map(Number)
      .filter((status) => status < 200 || status >= 300);

    const summary = [op.operation.summary, op.operation.description]
      .filter(Boolean)
      .join('\n\n');
    const { group, action } = classify(op.name);
    const doc = `${summary || op.name}\n\n${op.method} ${op.path} ([${op.name}], ${group}, ${action})`;
    built.push({
      op,
      name,
      args,
      body,
      bodyRequired: requestBody?.required === true,
      result,
      accept,
      ok,
      doc,
    });
  }

  function resolveAlias(o: O): O {
    let current = o;
    for (let i = 0; i < 20 && current.k === 'named'; i++) {
      const entry = types.get(current.name);
      if (entry?.kind !== 'alias') return current;
      current = entry.type;
    }
    return current;
  }

  /** Path, query and header values are scalars; query values may be lists. */
  function checkParameterType(o: O, allowList: boolean, what: string) {
    const r = resolveAlias(o.k === 'option' ? o.item : o);
    if (['string', 'int', 'float', 'bool'].includes(r.k)) return;
    if (r.k === 'variant' && r.cases.every((c) => 'literal' in c)) return;
    if (r.k === 'named' && !types.has(r.name)) return; // defined later; checked after
    if (allowList && r.k === 'list')
      return checkParameterType(r.item, false, what);
    throw new Error(where(`${what}: a ${r.k} can't be sent as a parameter`));
  }

  for (const op of ops) buildOperation(op);
  defineComponents();
  // Re-check parameter types now that every named type is defined.
  for (const b of built)
    for (const arg of b.args)
      checkParameterType(
        arg.type,
        arg.kind === 'query',
        `${b.op.name}: parameter ${arg.wire}`
      );

  // Type groups: strongly connected components, dependencies first.

  function dependencies(o: O, out: Set<string>) {
    switch (o.k) {
      case 'list':
      case 'option':
      case 'assoc':
        dependencies(o.item, out);
        break;
      case 'named':
        out.add(o.name);
        break;
      case 'variant':
        for (const c of o.cases)
          if ('payload' in c) dependencies(c.payload, out);
        break;
      default:
        break;
    }
    return out;
  }

  const edges = new Map<string, string[]>();
  for (const [name, entry] of types) {
    const out = new Set<string>();
    if (entry.kind === 'record')
      for (const field of entry.fields) dependencies(field.type, out);
    else dependencies(entry.type, out);
    edges.set(name, [...out]);
  }
  const groups = stronglyConnected([...types.keys()], edges);

  for (const group of groups) {
    const labels = new Map<string, string>();
    const taken = new Set<string>();
    for (const name of group) {
      const entry = types.get(name);
      if (entry?.kind !== 'record') continue;
      for (const field of entry.fields) {
        if (field.constant !== undefined) continue;
        const other = labels.get(field.ocaml);
        // Records in one `type ... and` group can't share a label (warning
        // 30), so a later record's field takes a suffix.
        if (other && other !== name) field.ocaml = unique(field.ocaml, taken);
        else taken.add(field.ocaml);
        labels.set(field.ocaml, name);
      }
    }
  }

  // Printing

  type Scope = 'types' | 'outer';

  function typeExpr(o: O, scope: Scope): string {
    switch (o.k) {
      case 'string':
        return 'string';
      case 'int':
        return 'int';
      case 'float':
        return 'float';
      case 'bool':
        return 'bool';
      case 'unit':
      case 'empty':
        return 'unit';
      case 'json':
        return 'Macro_json.t';
      case 'list':
        return `${typeExpr(o.item, scope)} list`;
      case 'option':
        return `${typeExpr(o.item, scope)} option`;
      case 'assoc':
        return `(string * ${typeExpr(o.item, scope)}) list`;
      case 'named':
        return scope === 'types' ? o.name : `Types.${o.name}`;
      case 'variant':
        return `[ ${o.cases
          .map((c) =>
            'payload' in c
              ? `\`${c.tag} of ${typeExpr(c.payload, scope)}`
              : `\`${c.tag}`
          )
          .join(' | ')} ]`;
    }
  }

  function literalJson(value: Literal) {
    if (value === null) return '`Null';
    if (typeof value === 'boolean') return `(\`Bool ${value})`;
    if (typeof value === 'number')
      return Number.isInteger(value)
        ? `(\`Int ${ocamlInt(value)})`
        : `(\`Float ${ocamlFloat(value)})`;
    return `(\`String ${ocamlString(value)})`;
  }

  function literalPattern(value: Literal) {
    if (value === null) return '`Null';
    if (typeof value === 'boolean') return `\`Bool ${value}`;
    if (typeof value === 'number')
      return Number.isInteger(value)
        ? `\`Int ${ocamlInt(value)}`
        : `\`Float ${ocamlFloat(value)}`;
    return `\`String ${ocamlString(value)}`;
  }

  function codec(scope: Scope, name: string, direction: 'enc' | 'dec') {
    return scope === 'types'
      ? `${direction}_${name}`
      : `Types.${direction}_${name}`;
  }

  function enc(o: O, v: string, scope: Scope, depth = 0): string {
    const x = `x${depth}`;
    switch (o.k) {
      case 'string':
        return `(\`String ${v})`;
      case 'int':
        return `(\`Int ${v})`;
      case 'float':
        return `(\`Float ${v})`;
      case 'bool':
        return `(\`Bool ${v})`;
      case 'unit':
        return `(Macro_runtime.enc_null ${v})`;
      case 'empty':
        return `(Macro_runtime.enc_empty ${v})`;
      case 'json':
        return v;
      case 'list':
        return `(\`List (List.map (fun ${x} -> ${enc(o.item, x, scope, depth + 1)}) ${v}))`;
      case 'option':
        return `(match ${v} with None -> \`Null | Some ${x} -> ${enc(o.item, x, scope, depth + 1)})`;
      case 'assoc':
        return `(\`Assoc (List.map (fun (k${depth}, ${x}) -> (k${depth}, ${enc(o.item, x, scope, depth + 1)})) ${v}))`;
      case 'named':
        return `(${codec(scope, o.name, 'enc')} ${v})`;
      case 'variant': {
        const tagKey = o.tagKey;
        return `(match ${v} with ${o.cases
          .map((c) => {
            if ('literal' in c)
              return `\`${c.tag} -> ${literalJson(c.literal)}`;
            const withTag = (encoded: string) =>
              tagKey !== undefined && c.tagValue !== undefined
                ? `(Macro_runtime.set_field ${ocamlString(tagKey)} ${literalJson(c.tagValue)} ${encoded})`
                : encoded;
            if ('object' in c)
              return `\`${c.tag} -> (\`Assoc [ ${c.object.map(([key, value]) => `(${ocamlString(key)}, ${literalJson(value)})`).join('; ')} ])`;
            return `\`${c.tag} ${x} -> ${withTag(enc(c.payload, x, scope, depth + 1))}`;
          })
          .join(' | ')})`;
      }
    }
  }

  function dec(
    o: O,
    j: string,
    scope: Scope,
    depth = 0,
    strictInt = false
  ): string {
    const x = `x${depth}`;
    switch (o.k) {
      case 'string':
        return `(Macro_runtime.dec_string ${j})`;
      case 'int':
        return strictInt
          ? `(Macro_runtime.dec_int_strict ${j})`
          : `(Macro_runtime.dec_int ${j})`;
      case 'float':
        return `(Macro_runtime.dec_float ${j})`;
      case 'bool':
        return `(Macro_runtime.dec_bool ${j})`;
      case 'unit':
        return `(Macro_runtime.dec_null ${j})`;
      case 'empty':
        return `(Macro_runtime.dec_empty ${j})`;
      case 'json':
        return j;
      case 'list':
        return `(List.map (fun ${x} -> ${dec(o.item, x, scope, depth + 1)}) (Macro_runtime.dec_list ${j}))`;
      case 'option':
        return `(match ${j} with \`Null -> None | ${x} -> Some ${dec(o.item, x, scope, depth + 1)})`;
      case 'assoc':
        return `(List.map (fun (k${depth}, ${x}) -> (k${depth}, ${dec(o.item, x, scope, depth + 1)})) (Macro_runtime.dec_assoc ${j}))`;
      case 'named':
        return `(${codec(scope, o.name, 'dec')} ${j})`;
      case 'variant': {
        const literalArms = o.cases.flatMap((c) =>
          'literal' in c ? [`${literalPattern(c.literal)} -> \`${c.tag}`] : []
        );
        const caseDecoder = (c: Case) => {
          if ('payload' in c)
            return `\`${c.tag} ${dec(c.payload, x, scope, depth + 1, o.strictInt)}`;
          if ('object' in c)
            return `(${c.object.map(([key, value]) => `Macro_runtime.expect_field ${x} ${ocamlString(key)} ${literalJson(value)}; `).join('')}\`${c.tag})`;
          return '';
        };
        const tagged = o.cases.filter(
          (c) =>
            !('literal' in c) &&
            o.tagKey !== undefined &&
            c.tagValue !== undefined
        );
        const untagged = o.cases.filter(
          (c) => !('literal' in c) && !tagged.includes(c)
        );
        const arms = [...literalArms];
        if (tagged.length) {
          const dispatch = tagged
            .map(
              (c) =>
                `${literalPattern((c as { tagValue: Literal }).tagValue)} -> ${caseDecoder(c)}`
            )
            .join(' | ');
          arms.push(
            `\`Assoc _ as ${x} -> (match Macro_runtime.field ${x} ${ocamlString(o.tagKey as string)} with ${dispatch} | other -> Macro_runtime.fail ${ocamlString(`${o.tagKey} one of ${tagged.map((c) => JSON.stringify((c as { tagValue: Literal }).tagValue)).join(', ')}`)} other)`
          );
        }
        if (untagged.length)
          arms.push(
            `${x} -> Macro_runtime.attempt ${x} [ ${untagged.map((c) => `(fun ${x} -> ${caseDecoder(c)})`).join('; ')} ]`
          );
        else
          arms.push(
            `${x} -> Macro_runtime.fail ${ocamlString(`one of ${o.cases.map((c) => ('literal' in c ? JSON.stringify(c.literal) : c.tag)).join(', ')}`)} ${x}`
          );
        return `(match ${j} with ${arms.join(' | ')})`;
      }
    }
  }

  function typeDeclaration(entry: Named) {
    if (entry.kind === 'alias')
      return `${entry.name} = ${typeExpr(entry.type, 'types')}`;
    return `${entry.name} = {\n${entry.fields
      .filter((field) => field.constant === undefined)
      .map((field) => `    ${field.ocaml} : ${typeExpr(field.type, 'types')};`)
      .join('\n')}\n  }`;
  }

  const typeGroups = groups
    .map((group) =>
      group
        .map((name, position) => {
          const entry = types.get(name);
          if (!entry) throw new Error(`lost type ${name}`);
          return `  ${position ? 'and' : 'type'} ${typeDeclaration(entry)}`;
        })
        .join('\n')
    )
    .join('\n\n');

  function codecs(entry: Named): string[] {
    const { name } = entry;
    if (entry.kind === 'alias')
      return [
        `enc_${name} (v : ${name}) : Macro_json.t = ${enc(entry.type, 'v', 'types')}`,
        `dec_${name} (j : Macro_json.t) : ${name} = ${dec(entry.type, 'j', 'types')}`,
      ];
    return [
      `enc_${name} (v : ${name}) : Macro_json.t =\n    Macro_runtime.obj [ ${entry.fields
        .map((field) =>
          field.constant !== undefined
            ? `(${ocamlString(field.json)}, Some ${literalJson(field.constant)})`
            : field.omit
              ? `(${ocamlString(field.json)}, Option.map (fun x -> ${enc((field.type as { item: O }).item, 'x', 'types', 1)}) v.${field.ocaml})`
              : `(${ocamlString(field.json)}, Some ${enc(field.type, `v.${field.ocaml}`, 'types', 1)})`
        )
        .join('; ')} ]`,
      `dec_${name} (j : Macro_json.t) : ${name} =\n    ignore (Macro_runtime.dec_assoc j);${entry.fields
        .filter((field) => field.constant !== undefined)
        .map(
          (field) =>
            `\n    Macro_runtime.expect_field j ${ocamlString(field.json)} ${literalJson(field.constant ?? null)};`
        )
        .join('')}\n    {\n${entry.fields
        .filter((field) => field.constant === undefined)
        .map((field) =>
          field.type.k === 'option'
            ? `      ${field.ocaml} = Macro_runtime.opt_field j ${ocamlString(field.json)} (fun x -> ${dec(field.type.item, 'x', 'types', 1)});`
            : `      ${field.ocaml} = ${dec(field.type, `(Macro_runtime.req_field j ${ocamlString(field.json)})`, 'types', 1)};`
        )
        .join('\n')}\n    }`,
    ];
  }

  const codecGroups = groups
    .map((group) => {
      const recursive =
        group.length > 1 ||
        (edges.get(group[0] as string) ?? []).includes(group[0] as string);
      const parts = group.flatMap((name) => codecs(types.get(name) as Named));
      if (recursive) return `  let rec ${parts.join('\n\n  and ')}\n`;
      return parts.map((part) => `  let ${part}\n`).join('\n');
    })
    .join('\n');

  const typeValuesMl: string[] = [];
  const typeValuesMli: string[] = [];
  const typeValueNames = new Set<string>();
  const claimTypeValue = (value: string) => {
    if (typeValueNames.has(value))
      throw new Error(where(`Types.${value} is defined twice`));
    typeValueNames.add(value);
  };
  for (const entry of types.values()) {
    const { name } = entry;
    if (entry.kind === 'record') {
      const parameters = entry.fields.filter(
        (field) => field.constant === undefined
      );
      const signature = [
        ...parameters.map((field) =>
          field.type.k === 'option'
            ? `?${field.ocaml}:${typeExpr(field.type.item, 'types')}`
            : `${field.ocaml}:${typeExpr(field.type, 'types')}`
        ),
        'unit',
      ].join(' -> ');
      claimTypeValue(`make_${name}`);
      typeValuesMl.push(
        `  let make_${name} ${[...parameters.map((field) => `${field.type.k === 'option' ? '?' : '~'}${field.ocaml}`), '()'].join(' ')} : ${name} =\n    { ${parameters.map((field) => field.ocaml).join('; ')} }\n`
      );
      typeValuesMli.push(
        `  val make_${name} : ${signature} -> ${name}\n  [@@macro.pure]\n`
      );
    }
    claimTypeValue(`${name}_to_json`);
    claimTypeValue(`${name}_of_json`);
    typeValuesMl.push(
      `  let ${name}_to_json (v : ${name}) : Macro_json.t = enc_${name} v\n`,
      `  let ${name}_of_json (j : Macro_json.t) : ${name} = Macro_runtime.decode ${ocamlString(`Macro.${module}.Types.${name}_of_json`)} dec_${name} j\n`
    );
    typeValuesMli.push(
      `  val ${name}_to_json : ${name} -> Macro_json.t\n  [@@macro.pure]\n`,
      `  val ${name}_of_json : Macro_json.t -> ${name}\n  [@@macro.pure]\n`
    );
  }

  // Operation functions

  function resultType(result: Result): string {
    const caseType = (c: ResponseCase) =>
      c.kind === 'json'
        ? typeExpr(c.type, 'outer')
        : c.kind === 'text'
          ? 'string'
          : 'unit';
    if (result.kind === 'single') return caseType(result.case);
    if (result.kind === 'optional')
      return `${typeExpr(result.case.type, 'outer')} option`;
    return `[ ${result.cases.map((c) => (c.kind === 'unit' ? `\`Http_${c.status}` : `\`Http_${c.status} of ${caseType(c)}`)).join(' | ')} ]`;
  }

  function resultCode(b: Built): string {
    const operation = ocamlString(b.op.name);
    const caseValue = (c: ResponseCase) =>
      c.kind === 'json'
        ? `Macro_runtime.json_result ~operation:${operation} (fun j -> ${dec(c.type, 'j', 'outer')}) response`
        : c.kind === 'text'
          ? 'Macro_runtime.text_result response'
          : 'Macro_runtime.unit_result response';
    const { result } = b;
    if (result.kind === 'single') return caseValue(result.case);
    if (result.kind === 'optional')
      return `if response.Macro_runtime.status = 204 || Macro_runtime.is_empty response then None else Some (${caseValue(result.case)})`;
    return `match response.Macro_runtime.status with ${result.cases
      .map(
        (c) =>
          `${c.status} -> ${c.kind === 'unit' ? `\`Http_${c.status}` : `\`Http_${c.status} (${caseValue(c)})`}`
      )
      .join(
        ' | '
      )} | _ -> Macro_runtime.unexpected_status ~operation:${operation} response`;
  }

  const opsMl: string[] = [];
  const opsMli: string[] = [];
  const entries: OperationEntry[] = [];

  for (const b of built) {
    const { op } = b;
    const signatureParts: string[] = [];
    const patterns: string[] = [];
    for (const arg of b.args) {
      signatureParts.push(
        `${arg.optional ? '?' : ''}${arg.label}:${typeExpr(arg.type, 'outer')}`
      );
      patterns.push(`${arg.optional ? '?' : '~'}${arg.label}`);
    }
    let bodyCode = 'None';
    let bodyType: string | undefined;
    if (b.body) {
      const optional = !b.bodyRequired;
      const value = (v: string) => {
        const body = b.body as Body;
        if (body.kind === 'json')
          return `(${ocamlString(body.contentType)}, Macro_runtime.json_text ${enc(body.type, v, 'outer')})`;
        if (body.kind === 'text')
          return `(${ocamlString(body.contentType)}, ${v})`;
        const parts = body.fields.map((field) => {
          const part = (x: string) =>
            field.binary
              ? `Macro_runtime.File ${x}`
              : `Macro_runtime.Text (Macro_runtime.scalar_text ${ocamlString(field.json)} ${enc(field.type, x, 'outer')})`;
          return field.omit
            ? `(match ${v}.Types.${field.ocaml} with None -> [] | Some x -> [ (${ocamlString(field.json)}, ${part('x')}) ])`
            : `[ (${ocamlString(field.json)}, ${part(`${v}.Types.${field.ocaml}`)}) ]`;
        });
        return `(Macro_runtime.multipart (List.concat [ ${parts.join('; ')} ]))`;
      };
      bodyType =
        b.body.kind === 'text' ? 'string' : typeExpr(b.body.type, 'outer');
      signatureParts.push(`${optional ? '?' : ''}body:${bodyType}`);
      patterns.push(`${optional ? '?' : '~'}body`);
      bodyCode = optional
        ? `(Option.map (fun body -> ${value('body')}) body)`
        : `(Some ${value('body')})`;
    }
    signatureParts.push('unit');
    patterns.push('()');

    const segments = op.path.split(/(\{[^}]+\})/).filter(Boolean);
    const pathParts = segments.map((segment) => {
      const match = segment.match(/^\{(.+)\}$/);
      if (!match) return ocamlString(segment);
      const arg = b.args.find((a) => a.kind === 'path' && a.wire === match[1]);
      if (!arg) throw new Error(`${op.name}: lost path parameter ${match[1]}`);
      return `Macro_runtime.path_segment ${ocamlString(arg.wire)} ${enc(arg.type, arg.label, 'outer')}`;
    });
    const pathCode =
      pathParts.length === 1
        ? pathParts[0]
        : `(String.concat "" [ ${pathParts.join('; ')} ])`;
    const listCode = (kind: 'query' | 'header') => {
      const items = b.args
        .filter((arg) => arg.kind === kind)
        .map((arg) =>
          arg.optional
            ? `Macro_runtime.${kind}_opt ${ocamlString(arg.wire)} (fun v -> ${enc(arg.type, 'v', 'outer')}) ${arg.label}`
            : `Macro_runtime.${kind} ${ocamlString(arg.wire)} ${enc(arg.type, arg.label, 'outer')}`
        );
      return items.length ? `(List.concat [ ${items.join('; ')} ])` : '[]';
    };
    const ml = `let ${b.name} ${patterns.join(' ')} =
  let response =
    Macro_runtime.call ~operation:${ocamlString(op.name)} ~service:${ocamlString(service)} ~meth:${ocamlString(op.method)}
      ~path:${pathCode}
      ~query:${listCode('query')}
      ~headers:${listCode('header')}
      ~body:${bodyCode} ~accept:${ocamlString(b.accept)} ~ok:${b.ok.length ? `[ ${b.ok.join('; ')} ]` : '[]'}
  in
  ${resultCode(b)}
`;
    opsMl.push(ml);
    const signature = `${signatureParts.join(' -> ')} -> ${resultType(b.result)}`;
    opsMli.push(
      `${docComment(b.doc, '')}val ${b.name} : ${signature}\n[@@macro.op ${ocamlString(op.name)}]\n`
    );
    const { group, action } = classify(op.name);
    entries.push({
      name: op.name,
      service,
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      group,
      action,
      headers: op.headers,
      ocaml: `Macro.${module}.${b.name}`,
    });
  }

  stats.operations += built.length;
  stats.types += types.size;
  stats.records += [...types.values()].filter(
    (entry) => entry.kind === 'record'
  ).length;

  const banner = `(* Generated by packages/sdk-ocaml/generator from packages/sdk/specs/${service}.json. Do not edit. *)\n`;
  const ml = `${banner}
module Types = struct
${typeGroups}

${codecGroups}
${typeValuesMl.join('')}end

${opsMl.join('\n')}`;
  const mli = `${banner}
(** The records and variants the ${service} operations take and return, with a [make_*] constructor and JSON codecs for each record. *)
module Types : sig
${typeGroups}

${typeValuesMli.join('\n')}end

${opsMli.join('\n')}`;

  // Sample calls: required arguments only, then every argument.

  type Sample = { ocaml: string; json: unknown; omit?: true };

  function sample(
    o: O,
    depth: number,
    full: boolean,
    parameter: false | 'path' | 'query' = false
  ): Sample {
    if (depth > 30) throw new Error(where(`sample value nests too deep`));
    const deep = depth > 3;
    switch (o.k) {
      case 'string':
        if (parameter === 'path')
          return { ocaml: ocamlString(PATH_STRING), json: PATH_STRING };
        if (parameter)
          return { ocaml: ocamlString(QUERY_STRING), json: QUERY_STRING };
        return { ocaml: '"sample"', json: 'sample' };
      case 'int':
        return { ocaml: '7', json: 7 };
      case 'float':
        return { ocaml: '2.5', json: 2.5 };
      case 'bool':
        return { ocaml: 'true', json: true };
      case 'unit':
        return { ocaml: '()', json: null };
      case 'empty':
        return { ocaml: '()', json: {} };
      case 'json':
        return {
          ocaml: '(`Assoc [ ("any", `Bool true) ])',
          json: { any: true },
        };
      case 'list': {
        if (deep && !parameter) return { ocaml: '[]', json: [] };
        const item = sample(o.item, depth + 1, full, parameter);
        return { ocaml: `[ ${item.ocaml} ]`, json: [item.json] };
      }
      case 'option': {
        if (deep) return { ocaml: 'None', json: null };
        const item = sample(o.item, depth + 1, full, parameter);
        return { ocaml: `(Some ${item.ocaml})`, json: item.json };
      }
      case 'assoc': {
        if (deep) return { ocaml: '[]', json: {} };
        const item = sample(o.item, depth + 1, full);
        return {
          ocaml: `[ ("key", ${item.ocaml}) ]`,
          json: { key: item.json },
        };
      }
      case 'named': {
        const entry = types.get(o.name);
        if (!entry) throw new Error(`lost type ${o.name}`);
        if (entry.kind === 'alias') {
          const inner = sample(entry.type, depth, full, parameter);
          return inner;
        }
        const labels: string[] = [];
        const json: Record<string, unknown> = {};
        for (const field of entry.fields) {
          if (field.constant !== undefined) {
            json[field.json] = field.constant;
            continue;
          }
          if (field.type.k === 'option') {
            if (!full || deep) {
              if (!field.omit) json[field.json] = null;
              continue;
            }
            const value = sample(field.type.item, depth + 1, full);
            labels.push(`~${field.ocaml}:${value.ocaml} `);
            json[field.json] = value.json;
            continue;
          }
          const value = sample(field.type, depth + 1, full);
          labels.push(`~${field.ocaml}:${value.ocaml} `);
          json[field.json] = value.json;
        }
        return {
          ocaml: `(Macro.${module}.Types.make_${o.name} ${labels.join('')}())`,
          json,
        };
      }
      case 'variant': {
        // Deep down, prefer a case that ends the nesting; with all
        // arguments, the last case.
        const ends = o.cases.find((c) => !('payload' in c));
        const pick =
          (deep && ends) || (full ? o.cases[o.cases.length - 1] : o.cases[0]);
        if (!pick) throw new Error('empty variant');
        if ('literal' in pick)
          return { ocaml: `\`${pick.tag}`, json: pick.literal };
        if ('object' in pick)
          return {
            ocaml: `\`${pick.tag}`,
            json: Object.fromEntries(pick.object),
          };
        const payload = sample(pick.payload, depth + 1, full, parameter);
        let json = payload.json;
        if (
          o.tagKey !== undefined &&
          pick.tagValue !== undefined &&
          json &&
          typeof json === 'object' &&
          !Array.isArray(json)
        )
          json = { [o.tagKey]: pick.tagValue, ...(json as object) };
        return { ocaml: `(\`${pick.tag} ${payload.ocaml})`, json };
      }
    }
  }

  function scalarText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean')
      return String(value);
    throw new Error(`not a scalar: ${JSON.stringify(value)}`);
  }

  const calls: string[] = [];
  const fixtures: CallFixture[] = [];
  for (const b of built) {
    for (const variant of ['required', 'full'] as const) {
      const full = variant === 'full';
      const rendered: string[] = [];
      const values = new Map<string, unknown>();
      for (const arg of b.args) {
        if (arg.optional && !full) continue;
        const value = sample(
          arg.type,
          0,
          full,
          arg.kind === 'path' ? 'path' : 'query'
        );
        values.set(arg.label, value.json);
        rendered.push(`~${arg.label}:${value.ocaml}`);
      }
      let body: CallFixture['body'] = null;
      if (b.body && (b.bodyRequired || full)) {
        if (b.body.kind === 'text') {
          rendered.push('~body:"sample body"');
          body = { contentType: b.body.contentType, text: 'sample body' };
        } else {
          const value = sample(b.body.type, 0, full);
          rendered.push(`~body:${value.ocaml}`);
          body =
            b.body.kind === 'json'
              ? { contentType: b.body.contentType, json: value.json }
              : { contentType: 'multipart/form-data', multipart: true };
        }
      }
      rendered.push('()');
      const target = `/api/${service}${b.op.path.replace(
        /\{([^}]+)\}/g,
        (_, placeholder: string) => {
          const arg = b.args.find(
            (a) => a.kind === 'path' && a.wire === placeholder
          );
          return percentEncode(scalarText(values.get(arg?.label ?? '')));
        }
      )}`;
      const pairs = (kind: 'query' | 'header') =>
        b.args.flatMap((arg): [string, string][] => {
          if (arg.kind !== kind || !values.has(arg.label)) return [];
          const value = values.get(arg.label);
          if (value === null) return [];
          if (Array.isArray(value))
            return value.map((item) => [arg.wire, scalarText(item)]);
          return [[arg.wire, scalarText(value)]];
        });
      const response = responseSample(b, full);
      calls.push(
        `    (${ocamlString(b.op.name)}, fun () -> ignore (Macro.${module}.${b.name} ${rendered.join(' ')}));\n`
      );
      fixtures.push({
        name: b.op.name,
        variant,
        method: b.op.method,
        target,
        query: pairs('query'),
        headers: pairs('header'),
        body,
        response,
      });
    }
  }

  // A reply for each sample call, generated from the response schema (not
  // from the OCaml type), so the test checks each decoder against the spec.

  function responseSample(b: Built, last: boolean): CallFixture['response'] {
    const { result } = b;
    const cases = result.kind === 'status' ? result.cases : [result.case];
    const c = (last ? cases[cases.length - 1] : cases[0]) as ResponseCase;
    if (c.kind === 'json')
      return {
        status: c.status,
        contentType: 'application/json',
        body: JSON.stringify(schemaSample(c.schema, 0, last)),
      };
    if (c.kind === 'text')
      return {
        status: c.status,
        contentType: c.contentType === '*/*' ? 'text/plain' : c.contentType,
        body: 'sample text',
      };
    return { status: c.status, contentType: null, body: '' };
  }

  function schemaSample(
    schema: JsonSchema,
    depth: number,
    last: boolean
  ): unknown {
    if (depth > 40) throw new Error(where(`sample reply nests too deep`));
    const v = view(schema, 'sample');
    const deep = depth > 3;
    const members = (v.oneOf ?? v.anyOf) as JsonSchema[] | undefined;
    if (members) {
      // Deep down, the member that ends the nesting soonest.
      const cost = (m: JsonSchema) => {
        const k = kinds(m, 'sample');
        if (k.has('null')) return 0;
        if (k.has('object'))
          return (
            3 +
            ((view(m, 'sample').required as string[] | undefined)?.length ?? 0)
          );
        return k.has('array') ? 2 : 1;
      };
      const pick = deep
        ? [...members].sort((a, b) => cost(a) - cost(b))[0]
        : last
          ? members[members.length - 1]
          : members[0];
      return schemaSample(pick as JsonSchema, depth + 1, last);
    }
    if ('const' in v) return v.const;
    if (Array.isArray(v.enum))
      return last ? v.enum[v.enum.length - 1] : v.enum[0];
    const types = typeList(v);
    const type = types
      ? (types.find((t) => t !== 'null') ?? 'null')
      : v.properties || v.additionalProperties
        ? 'object'
        : 'any';
    if (types?.includes('null') && deep) return null;
    switch (type) {
      case 'null':
        return null;
      case 'string':
        return v.format === 'date-time'
          ? '2026-01-02T03:04:05Z'
          : v.format === 'uuid'
            ? '0190a9e2-5f2b-7c3d-8e4f-123456789abc'
            : 'sample';
      case 'integer':
        return 3;
      case 'number':
        return 2.5;
      case 'boolean':
        return true;
      case 'array':
        return deep || !v.items
          ? []
          : [schemaSample(v.items as JsonSchema, depth + 1, last)];
      case 'object': {
        const out: Record<string, unknown> = {};
        const required = new Set((v.required as string[] | undefined) ?? []);
        for (const [key, property] of Object.entries(
          (v.properties ?? {}) as Record<string, JsonSchema>
        ))
          if (required.has(key) || (!deep && last))
            out[key] = schemaSample(property, depth + 1, last);
        if (
          v.additionalProperties &&
          typeof v.additionalProperties === 'object' &&
          !deep
        )
          out.key = schemaSample(
            v.additionalProperties as JsonSchema,
            depth + 1,
            last
          );
        return out;
      }
      default:
        return { any: true };
    }
  }

  return { unitName, module, ml, mli, entries, calls, fixtures };
}

/** Path and query string samples that need percent-encoding. */
export const PATH_STRING = 'a b?ü&=#';
export const QUERY_STRING = 'a b/ü?&=#%+';

/** Tarjan's algorithm, iteratively; components come out dependencies first. */
function stronglyConnected(
  nodes: string[],
  edges: Map<string, string[]>
): string[][] {
  const groups: string[][] = [];
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  for (const start of nodes) {
    if (index.has(start)) continue;
    const work: { node: string; next: number }[] = [{ node: start, next: 0 }];
    index.set(start, counter);
    low.set(start, counter++);
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      if (!frame) break;
      const targets = edges.get(frame.node) ?? [];
      if (frame.next < targets.length) {
        const target = targets[frame.next++] ?? '';
        if (!index.has(target)) {
          index.set(target, counter);
          low.set(target, counter++);
          stack.push(target);
          onStack.add(target);
          work.push({ node: target, next: 0 });
        } else if (onStack.has(target))
          low.set(
            frame.node,
            Math.min(low.get(frame.node) ?? 0, index.get(target) ?? 0)
          );
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent)
        low.set(
          parent.node,
          Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0)
        );
      if (low.get(frame.node) === index.get(frame.node)) {
        const group: string[] = [];
        for (;;) {
          const member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          group.push(member);
          if (member === frame.node) break;
        }
        groups.push(group.sort());
      }
    }
  }
  return groups;
}

export function emptyStats(): Stats {
  return {
    operations: 0,
    types: 0,
    records: 0,
    bodies: { total: 0, typed: 0, json: 0, text: 0, multipart: 0, untyped: [] },
    parameters: { total: 0, typed: 0, json: 0 },
    responses: {
      total: 0,
      typed: 0,
      json: 0,
      text: 0,
      unit: 0,
      byStatus: 0,
      untyped: [],
    },
    unionFallbacks: [],
    openSchemas: 0,
  };
}

export const MACRO_MLI_PRELUDE = `(** A typed client for Macro's HTTP APIs, generated from their OpenAPI
    specs: one module per service, one function per operation. Every
    operation is a blocking call through the SDK proxy
    (MACRO_SDK_PROXY_URL); a failure raises [Error]. A program defines
    [let main () : Macro.Json.t = ...]. *)

(** JSON values, and pure helpers to read results and build return values. *)
module Json : sig
  type t = Yojson.Safe.t

  (** The field's value; [\`Null] when absent or the value is [\`Null]. *)
  val member : string -> t -> t
  [@@macro.pure]

  val to_string : t -> string
  [@@macro.pure]

  val to_float : t -> float
  [@@macro.pure]

  val to_int : t -> int
  [@@macro.pure]

  val to_bool : t -> bool
  [@@macro.pure]

  val to_list : t -> t list
  [@@macro.pure]

  val to_assoc : t -> (string * t) list
  [@@macro.pure]

  val to_option : (t -> 'a) -> t -> 'a option
  [@@macro.pure]

  val is_null : t -> bool
  [@@macro.pure]

  val null : t
  [@@macro.pure]

  val string : string -> t
  [@@macro.pure]

  val float : float -> t
  [@@macro.pure]

  val int : int -> t
  [@@macro.pure]

  val bool : bool -> t
  [@@macro.pure]

  val list : t list -> t
  [@@macro.pure]

  val obj : (string * t) list -> t
  [@@macro.pure]

  val option : ('a -> t) -> 'a option -> t
  [@@macro.pure]

  (** Shortened text of a value, for messages. *)
  val show : t -> string
  [@@macro.pure]

  val to_text : t -> string
  [@@macro.pure]

  val of_text : string -> t
  [@@macro.pure]
end

(** Every failure. [status] is the HTTP status of the reply (0 when there was
    none). When the SDK proxy refused the call itself, [code] is its reason:
    [blocked] (the permission endpoint said no), [not_analyzed] (the
    operation is not in the program's analyzed set), [unknown_operation] or
    [unauthorized]. Otherwise it follows the service's status: [invalid]
    (400, 422), [unauthorized] (401), [forbidden] (403), [not_found] (404,
    410), [conflict] (409, 412), [rate_limited] (429), [internal] (5xx),
    [failed] (others); or [decode] (a reply that doesn't match its type),
    [unreachable] (no connection to the proxy). *)
exception Error of { code : string; message : string; status : int }
`;
