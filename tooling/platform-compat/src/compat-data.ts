import bcd from '@mdn/browser-compat-data' with { type: 'json' };
import type {
  BrowserName,
  CompatStatement,
  Identifier,
  SimpleSupportStatement,
} from '@mdn/browser-compat-data';
import { type BrowserFloor, compareVersions } from './browser-floor';

export type Feature = { key: string; compat: CompatStatement };

export type MissingSupport = {
  browser: BrowserName;
  floorVersion: string;
  addedVersion: string | undefined;
};

function child(
  identifier: Identifier | undefined,
  name: string
): Identifier | undefined {
  if (!identifier || name === '__compat' || !Object.hasOwn(identifier, name))
    return undefined;
  return identifier[name];
}

function feature(
  root: 'api' | 'javascript',
  path: readonly string[]
): Feature | undefined {
  let identifier: Identifier | undefined = bcd[root];
  for (const name of path) identifier = child(identifier, name);
  const compat = identifier?.__compat;
  return compat ? { key: [root, ...path].join('.'), compat } : undefined;
}

/** A global such as `SharedWorker`, `structuredClone` or `WeakRef`. */
export function globalFeature(name: string): Feature | undefined {
  return (
    feature('api', [name]) ??
    feature('api', ['Window', name]) ??
    feature('javascript', ['builtins', name])
  );
}

/** `new Name()`, whose constructor can lag behind the interface. */
export function constructorFeature(name: string): Feature | undefined {
  return feature('api', [name, name]) ?? globalFeature(name);
}

const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);

/** Globals that are instances of an interface, keyed to that interface. */
const GLOBAL_INSTANCES: Readonly<Record<string, string>> = {
  navigator: 'Navigator',
  document: 'Document',
  crypto: 'Crypto',
  performance: 'Performance',
  screen: 'Screen',
  location: 'Location',
  history: 'History',
  localStorage: 'Storage',
  sessionStorage: 'Storage',
  indexedDB: 'IDBFactory',
  visualViewport: 'VisualViewport',
};

function isStaticBuiltin(object: string, property: string): boolean {
  const value: unknown = Reflect.get(globalThis, object);
  return (
    (typeof value === 'function' || typeof value === 'object') &&
    value !== null &&
    property in value
  );
}

/** `object.property` where `object` is a global. */
export function memberFeature(
  object: string,
  property: string
): Feature | undefined {
  if (GLOBAL_OBJECTS.has(object)) return globalFeature(property);
  const instanceOf = GLOBAL_INSTANCES[object];
  if (instanceOf) return feature('api', [instanceOf, property]);
  if (property === 'prototype') return undefined;
  // Compatibility data lists builtin statics next to prototype methods, so
  // only a property this runtime has on the constructor is a static.
  return (
    feature('api', [object, `${property}_static`]) ??
    (isStaticBuiltin(object, property)
      ? feature('javascript', ['builtins', object, property])
      : undefined)
  );
}

export function regexFeatures(pattern: string, flags: string): Feature[] {
  const features: (Feature | undefined)[] = [];
  if (/\(\?<[=!]/.test(pattern)) {
    features.push(
      feature('javascript', ['regular_expressions', 'lookbehind_assertion'])
    );
  }
  if (flags.includes('v'))
    features.push(feature('javascript', ['builtins', 'RegExp', 'unicodeSets']));
  if (flags.includes('d'))
    features.push(feature('javascript', ['builtins', 'RegExp', 'hasIndices']));
  return features.filter((found) => found !== undefined);
}

function supportedAt(
  statement: SimpleSupportStatement,
  version: string
): boolean {
  if (statement.flags || statement.prefix || statement.alternative_name)
    return false;
  const added = statement.version_added;
  if (typeof added !== 'string' || added === 'preview') return false;
  if (compareVersions(added.replace('≤', ''), version) > 0) return false;
  const removed = statement.version_removed;
  return (
    typeof removed !== 'string' ||
    compareVersions(removed.replace('≤', ''), version) > 0
  );
}

function firstRelease(
  statements: readonly SimpleSupportStatement[]
): string | undefined {
  return statements
    .filter(
      (statement) =>
        !statement.flags && !statement.prefix && !statement.alternative_name
    )
    .map((statement) => statement.version_added)
    .find(
      (added): added is string =>
        typeof added === 'string' && added !== 'preview'
    );
}

/** The first floor browser without unprefixed, unflagged support. Browsers the data omits count as supported. */
export function missingSupport(
  compat: CompatStatement,
  floor: BrowserFloor
): MissingSupport | undefined {
  for (const [browser, floorVersion] of floor) {
    const support = compat.support[browser];
    if (!support) continue;
    const statements = Array.isArray(support) ? support : [support];
    if (statements.some((statement) => supportedAt(statement, floorVersion)))
      continue;
    return { browser, floorVersion, addedVersion: firstRelease(statements) };
  }
  return undefined;
}
