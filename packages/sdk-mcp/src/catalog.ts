/**
 * The operation catalog `scripts/generate.ts` writes from the SDK's
 * declarations: one operation per public SDK method, with its parameter
 * schemas and the hint class its TSDoc tags give it.
 */

/** A value an operation accepts, as the generator read it from the SDK's types. */
export type Schema =
  | { type: 'string' }
  | { type: 'number' }
  | { type: 'boolean' }
  | { type: 'null' }
  | { type: 'json' }
  | { type: 'literal'; value: string | number | boolean }
  | { type: 'enum'; values: readonly (string | number)[] }
  | { type: 'array'; items: Schema }
  | {
      type: 'object';
      properties: Readonly<Record<string, Property>>;
      additional?: Schema;
    }
  | { type: 'union'; anyOf: readonly Schema[] }
  | { type: 'date' }
  | { type: 'handle'; class: string }
  | { type: 'ref'; name: string };

/** One property of an object schema, or one named parameter of a method. */
export type Property = {
  schema: Schema;
  optional: boolean;
  description?: string;
};

/**
 * Which tool an operation lands in. `read` only reads, `write` changes data
 * in a way the user can undo, and `delete` removes, overwrites or sends
 * something that cannot be taken back.
 */
export type HintClass = 'read' | 'write' | 'delete';

/** One method parameter, in call order. */
export type Parameter = Property & {
  name: string;
  /** A rest parameter: the value is an array spread into the call. */
  rest: boolean;
};

/**
 * A step from a handle or namespace to the object a method runs on: a
 * readonly property (`document.access`) or a call without arguments
 * (`document.canvas()`).
 */
export type PathStep = { name: string; call: boolean };

/**
 * One SDK method as an MCP operation. Namespace methods run on
 * `macro.<namespace...>`; handle methods on the handle the input's
 * `property` references, then through `path`.
 */
export type Operation = {
  name: string;
  /** The SDK entity directory the operation belongs to, e.g. `documents`. */
  group: string;
  hint: HintClass;
  openWorld: boolean;
  idempotent: boolean;
  description: string;
  receiver:
    | { kind: 'namespace'; path: readonly PathStep[] }
    | {
        kind: 'handle';
        class: string;
        /** The input property carrying the handle's reference. */
        property: string;
        path: readonly PathStep[];
      };
  method: string;
  parameters: readonly Parameter[];
  /** The method returns an async iterable, collected up to `maxItems`. */
  iterable: boolean;
};

/**
 * How to mint a handle class from a reference. A class with a `static byId`
 * lists its parameters in order, `client` for the SDK client and the rest
 * read from the reference. An abstract class (`FavoritableEntity`) takes any
 * of its concrete subclasses, as `{ kind, id }`.
 */
export type HandleReference =
  | {
      kind: 'byId';
      class: string;
      description: string;
      parameters: readonly (
        | { name: string; client: true }
        | (Property & { name: string; client: false })
      )[];
    }
  | {
      kind: 'any';
      class: string;
      description: string;
      subclasses: readonly string[];
    };

export type Catalog = {
  /** Each group's `@routing` sentence: when to use it, and when not. */
  groups: Readonly<Record<string, string>>;
  operations: readonly Operation[];
  handles: Readonly<Record<string, HandleReference>>;
  definitions: Readonly<Record<string, Schema>>;
};
