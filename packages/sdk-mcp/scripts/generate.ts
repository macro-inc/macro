/**
 * Read the SDK's declarations and write the MCP operation catalog
 * (`src/generated/catalog.ts`): one operation per public method of every
 * namespace under `Macro` and every handle class, with parameter schemas
 * from its TypeScript types and the hint class from its TSDoc tags.
 *
 * Usage: bun scripts/generate.ts
 *
 * The output is never committed; the tool-list snapshots in
 * `src/__snapshots__/` are what review sees. Generation fails on an untagged method, a method with two hint classes, a
 * parameter type MCP's JSON can't carry, or a class with tagged methods that
 * no operation can address; `@mcp-exclude <reason>` opts a method or a whole
 * class out.
 */

import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { entityDirectories } from '../../code-mode-sdk/scripts/catalog';
import type {
  Catalog,
  HandleReference,
  HintClass,
  Operation,
  Parameter,
  PathStep,
  Property,
  Schema,
} from '../src/catalog';
import { buildTools } from '../src/tools';

const sdkRoot = fileURLToPath(new URL('../../sdk/', import.meta.url));
const outputPath = fileURLToPath(
  new URL('../src/generated/catalog.ts', import.meta.url)
);

/** Methods every handle has that operations don't wrap. */
const SKIPPED_METHODS = new Set(['byId', 'toJSON']);

/** Types whose values MCP's JSON arguments cannot carry. */
const OPAQUE_TYPES = new Set([
  'AbortSignal',
  'ArrayBuffer',
  'Blob',
  'File',
  'FormData',
  'Map',
  'MediaStream',
  'MediaStreamTrack',
  'Promise',
  'ReadableStream',
  'Request',
  'Response',
  'Set',
  'Uint8Array',
  'WeakMap',
]);

const program = ts.createProgram([`${sdkRoot}src/macro.ts`], {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
const errors = new Set<string>();

function isSdkSource(file: ts.SourceFile) {
  return (
    file.fileName.startsWith(`${sdkRoot}src/`) &&
    !file.fileName.endsWith('.test.ts')
  );
}

function classOf(type: ts.Type): ts.ClassDeclaration | undefined {
  const declaration = type.getSymbol()?.declarations?.[0];
  if (!declaration || !ts.isClassDeclaration(declaration)) return undefined;
  return isSdkSource(declaration.getSourceFile()) ? declaration : undefined;
}

function className(declaration: ts.ClassDeclaration) {
  if (!declaration.name) throw new Error('anonymous SDK class');
  return declaration.name.text;
}

function hasModifier(node: ts.Node, flag: ts.ModifierFlags) {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & flag) !== 0;
}

function isPublicMember(member: ts.ClassElement) {
  if (
    hasModifier(member, ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
  )
    return false;
  if (!member.name || ts.isComputedPropertyName(member.name)) return false;
  const name = member.name.getText();
  return !name.startsWith('_') && !name.startsWith('#');
}

/** The raw TSDoc block above a declaration, tags included. */
function docText(node: ts.Node) {
  return ts
    .getJSDocCommentsAndTags(node)
    .map((doc) => doc.getText())
    .join('\n');
}

function description(symbol: ts.Symbol | undefined) {
  if (!symbol) return '';
  return ts
    .displayPartsToString(symbol.getDocumentationComment(checker))
    .trim();
}

function excludedReason(node: ts.Node) {
  return /@mcp-exclude\s+([^\n*]+)/.exec(docText(node))?.[1]?.trim();
}

type Hints = { hint: HintClass; openWorld: boolean; idempotent: boolean };

function hintsOf(where: string, node: ts.Node): Hints | undefined {
  const text = docText(node);
  const classes = (
    [
      ['read', /@readonly\b/],
      ['write', /@write\b/],
      ['delete', /@destructive\b/],
    ] as const
  ).filter(([, tag]) => tag.test(text));
  const [only, ...more] = classes;
  if (!only || more.length) {
    errors.add(
      `${where}: needs exactly one of @readonly, @write, @destructive (found ${classes.length})`
    );
    return undefined;
  }
  return {
    hint: only[0],
    openWorld: /@openworld\b/.test(text),
    idempotent: only[0] === 'read' || /@idempotent\b/.test(text),
  };
}

const sdkClasses = program
  .getSourceFiles()
  .filter(isSdkSource)
  .flatMap((file) => file.statements.filter(ts.isClassDeclaration))
  .sort((left, right) => className(left).localeCompare(className(right)));

// Handle classes: SDK classes with a `static byId`, minted from a reference.

const handles = new Map<string, HandleReference>();
const handleDeclarations = new Map<string, ts.ClassDeclaration>();
const unaddressable = new Map<string, string>();

function staticById(declaration: ts.ClassDeclaration) {
  return declaration.members.find(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) &&
      hasModifier(member, ts.ModifierFlags.Static) &&
      member.name.getText() === 'byId'
  );
}

/** Register `declaration` as a handle, or record why it can't be one. */
function addressable(declaration: ts.ClassDeclaration): boolean {
  const name = className(declaration);
  if (handles.has(name)) return true;
  if (unaddressable.has(name)) return false;
  if (hasModifier(declaration, ts.ModifierFlags.Abstract))
    return addressableAbstract(declaration);
  const byId = staticById(declaration);
  if (!byId) {
    unaddressable.set(name, 'it has no static byId');
    return false;
  }

  // Seed before converting, so a reference to itself terminates.
  handleDeclarations.set(name, declaration);
  const reference = {
    kind: 'byId',
    class: name,
    description: description(
      declaration.name && checker.getSymbolAtLocation(declaration.name)
    ),
  } as const;
  handles.set(name, { ...reference, parameters: [] });
  const parameters: Extract<
    HandleReference,
    { kind: 'byId' }
  >['parameters'][number][] = [];
  for (const parameter of byId.parameters) {
    const parameterName = parameter.name.getText();
    const type = checker.getTypeAtLocation(parameter);
    if (type.getSymbol()?.name === 'MacroClient') {
      parameters.push({ name: parameterName, client: true });
      continue;
    }
    const failures: string[] = [];
    const schema = convert(nonUndefined(type), failures);
    if (failures.length) {
      handles.delete(name);
      handleDeclarations.delete(name);
      unaddressable.set(
        name,
        `byId parameter ${parameterName}: ${failures.join('; ')}`
      );
      return false;
    }
    parameters.push({
      name: parameterName,
      client: false,
      schema,
      optional: isOptional(parameter),
    });
  }
  handles.set(name, { ...reference, parameters });
  return true;
}

/** Whether `declaration` extends `ancestor`, directly or through others. */
function extendsClass(
  declaration: ts.ClassDeclaration,
  ancestor: ts.ClassDeclaration
): boolean {
  const base = declaration.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword
  )?.types[0];
  const parent = base
    ? classOf(checker.getTypeAtLocation(base.expression))
    : undefined;
  if (!parent) return false;
  return parent === ancestor || extendsClass(parent, ancestor);
}

/** A reference that is one plain id, which a Macro URL can stand for. */
function isPlainReference(reference: HandleReference | undefined) {
  if (reference?.kind !== 'byId') return false;
  const read = reference.parameters.filter((parameter) => !parameter.client);
  const [only] = read;
  return (
    read.length === 1 &&
    only !== undefined &&
    !only.client &&
    only.schema.type === 'string'
  );
}

/** An abstract class takes any concrete subclass with a plain reference. */
function addressableAbstract(declaration: ts.ClassDeclaration): boolean {
  const name = className(declaration);
  const subclasses = sdkClasses
    .filter(
      (candidate) =>
        !hasModifier(candidate, ts.ModifierFlags.Abstract) &&
        extendsClass(candidate, declaration) &&
        addressable(candidate) &&
        isPlainReference(handles.get(className(candidate)))
    )
    .map(className);
  if (!subclasses.length) {
    unaddressable.set(name, 'no concrete subclass has a plain id reference');
    return false;
  }
  handles.set(name, {
    kind: 'any',
    class: name,
    description: description(
      declaration.name && checker.getSymbolAtLocation(declaration.name)
    ),
    subclasses,
  });
  return true;
}

// TypeScript types to schemas.

/** A type MCP's JSON can't carry: bytes, streams, functions and the like. */
function isOpaque(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.every(isOpaque);
  const symbolName = type.getSymbol()?.name;
  return (
    (symbolName !== undefined && OPAQUE_TYPES.has(symbolName)) ||
    type.getCallSignatures().length > 0
  );
}

const definitions = new Map<string, Schema>();
const definitionNames = new Map<ts.Type, string>();
const definitionsInProgress = new Set<ts.Type>();

function nonUndefined(type: ts.Type) {
  return checker.getNonNullableType(type) === type ||
    !(type.flags & ts.TypeFlags.Union)
    ? type
    : withoutUndefined(type);
}

function withoutUndefined(type: ts.Type): ts.Type {
  if (!type.isUnion()) return type;
  const members = type.types.filter(
    (member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void))
  );
  if (members.length === type.types.length) return type;
  const [first, ...rest] = members;
  return first && rest.length === 0 ? first : type;
}

function isOptional(parameter: ts.ParameterDeclaration) {
  return (
    parameter.questionToken !== undefined ||
    parameter.initializer !== undefined ||
    checker.isOptionalParameter(parameter)
  );
}

/** A deterministic, unique definition name for a named type. */
function definitionName(type: ts.Type) {
  const base = checker
    .typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  let name = base;
  for (
    let suffix = 2;
    definitions.has(name) || [...definitionNames.values()].includes(name);
    suffix++
  )
    name = `${base}_${suffix}`;
  return name;
}

function isNamed(type: ts.Type) {
  if (type.aliasSymbol) return true;
  const symbol = type.getSymbol();
  return (
    symbol !== undefined &&
    !symbol.name.startsWith('__') &&
    (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) !== 0
  );
}

/** Convert `type`, recording why in `failures` when MCP can't carry it. */
function convert(type: ts.Type, failures: string[]): Schema {
  const existing = definitionNames.get(type);
  if (existing) return { type: 'ref', name: existing };

  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
    return { type: 'json' };
  if (type.flags & ts.TypeFlags.StringLiteral)
    return { type: 'literal', value: (type as ts.StringLiteralType).value };
  if (type.flags & ts.TypeFlags.NumberLiteral)
    return { type: 'literal', value: (type as ts.NumberLiteralType).value };
  if (type.flags & ts.TypeFlags.BooleanLiteral)
    return { type: 'literal', value: checker.typeToString(type) === 'true' };
  if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral))
    return { type: 'string' };
  if (type.flags & ts.TypeFlags.Number) return { type: 'number' };
  if (type.flags & ts.TypeFlags.Boolean) return { type: 'boolean' };
  if (type.flags & ts.TypeFlags.Null) return { type: 'null' };
  if (
    type.flags &
    (ts.TypeFlags.BigInt |
      ts.TypeFlags.ESSymbol |
      ts.TypeFlags.Never |
      ts.TypeFlags.Void |
      ts.TypeFlags.Undefined)
  ) {
    failures.push(`unsupported type ${checker.typeToString(type)}`);
    return { type: 'json' };
  }

  if (type.isUnion()) return named(type, () => convertUnion(type, failures));

  if (type.isIntersection()) {
    // Branded primitives (`string & { brand }`) are their primitive.
    const primitive = type.types.find(
      (member) =>
        member.flags &
        (ts.TypeFlags.StringLike |
          ts.TypeFlags.NumberLike |
          ts.TypeFlags.BooleanLike)
    );
    if (primitive) return convert(primitive, failures);
    return named(type, () => convertObject(type, failures));
  }

  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const items = checker.getTypeArguments(type as ts.TypeReference);
    const [only] = items;
    const itemSchemas = items.map((item) => convert(item, failures));
    return {
      type: 'array',
      items:
        only && items.length === 1
          ? (itemSchemas[0] ?? { type: 'json' })
          : { type: 'union', anyOf: itemSchemas },
    };
  }

  const symbolName = type.getSymbol()?.name;
  if (symbolName === 'Date') return { type: 'date' };
  if (symbolName && OPAQUE_TYPES.has(symbolName)) {
    failures.push(`${symbolName} can't travel as JSON`);
    return { type: 'json' };
  }

  const declaration = classOf(type);
  if (declaration) {
    if (addressable(declaration))
      return { type: 'handle', class: className(declaration) };
    failures.push(
      `${className(declaration)} can't be referenced: ${unaddressable.get(className(declaration))}`
    );
    return { type: 'json' };
  }

  if (type.getCallSignatures().length) {
    failures.push(`a function (${checker.typeToString(type)})`);
    return { type: 'json' };
  }

  if (type.flags & ts.TypeFlags.Object) {
    if (type.isClass()) {
      failures.push(`class instance ${checker.typeToString(type)}`);
      return { type: 'json' };
    }
    return named(type, () => convertObject(type, failures));
  }

  failures.push(`unsupported type ${checker.typeToString(type)}`);
  return { type: 'json' };
}

/** Convert a named type once, as a definition other schemas reference. */
function named(type: ts.Type, build: () => Schema): Schema {
  if (!isNamed(type)) {
    if (definitionsInProgress.has(type)) {
      // An anonymous type that contains itself; give it a name.
      const name = definitionName(type);
      definitionNames.set(type, name);
      return { type: 'ref', name };
    }
    definitionsInProgress.add(type);
    const schema = build();
    definitionsInProgress.delete(type);
    const name = definitionNames.get(type);
    if (name) {
      definitions.set(name, schema);
      return { type: 'ref', name };
    }
    return schema;
  }
  const name = definitionName(type);
  definitionNames.set(type, name);
  definitions.set(name, { type: 'json' });
  definitions.set(name, build());
  return { type: 'ref', name };
}

function convertUnion(type: ts.UnionType, failures: string[]): Schema {
  const present = type.types.filter(
    (member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void))
  );
  // `string | Uint8Array` takes the string; bytes can't travel as JSON.
  const carried = present.filter((member) => !isOpaque(member));
  const members = carried.length ? carried : present;
  const literals = members.filter(
    (member) =>
      member.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)
  );
  const booleans = members.filter(
    (member) => member.flags & ts.TypeFlags.BooleanLiteral
  );
  const rest = members.filter(
    (member) => !literals.includes(member) && !booleans.includes(member)
  );

  const schemas: Schema[] = [];
  if (literals.length > 1)
    schemas.push({
      type: 'enum',
      values: literals.map(
        (member) => (member as ts.LiteralType).value as string | number
      ),
    });
  else schemas.push(...literals.map((member) => convert(member, failures)));
  if (booleans.length === 2) schemas.push({ type: 'boolean' });
  else schemas.push(...booleans.map((member) => convert(member, failures)));
  schemas.push(...rest.map((member) => convert(member, failures)));

  const [only] = schemas;
  return only && schemas.length === 1
    ? only
    : { type: 'union', anyOf: schemas };
}

function convertObject(type: ts.Type, failures: string[]): Schema {
  const properties: Record<string, Property> = {};
  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (property.name.startsWith('__@')) continue;
    if (declaration && ts.isMethodSignature(declaration)) {
      failures.push(
        `${checker.typeToString(type)}.${property.name} is a method`
      );
      continue;
    }
    const propertyType = declaration
      ? checker.getTypeOfSymbolAtLocation(property, declaration)
      : checker.getTypeOfSymbol(property);
    const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
    // An optional `signal` or callback is simply never passed, and a
    // `?: never` member of a union variant can never be set.
    const present = withoutUndefined(propertyType);
    if (
      optional &&
      (isOpaque(present) ||
        present.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Never))
    )
      continue;
    const nested: string[] = [];
    const schema = convert(
      optional ? withoutUndefined(propertyType) : propertyType,
      nested
    );
    failures.push(...nested.map((failure) => `${property.name}: ${failure}`));
    const text = description(property);
    properties[property.name] = {
      schema,
      optional,
      ...(text ? { description: text } : {}),
    };
  }
  const index = checker
    .getIndexInfosOfType(type)
    .find((info) => info.keyType.flags & ts.TypeFlags.String);
  return {
    type: 'object',
    properties,
    ...(index ? { additional: convert(index.type, failures) } : {}),
  };
}

// Methods to operations.

function returnShape(method: ts.MethodDeclaration) {
  const signature = checker.getSignatureFromDeclaration(method);
  if (!signature) throw new Error(`no signature for ${method.name.getText()}`);
  const returned = checker.getReturnTypeOfSignature(signature);
  const awaited = checker.getAwaitedType(returned) ?? returned;
  const iterable = checker
    .getPropertiesOfType(returned)
    .some((property) => property.name.startsWith('__@asyncIterator'));
  const sync = checker.getAwaitedType(returned) === returned;
  return { returned: awaited, iterable, sync };
}

function isSubObject(type: ts.Type) {
  const declaration = classOf(type);
  return (
    declaration !== undefined &&
    !staticById(declaration) &&
    publicMethods(declaration).length > 0
  );
}

function publicMethods(declaration: ts.ClassDeclaration) {
  return declaration.members.filter(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) &&
      !hasModifier(member, ts.ModifierFlags.Static) &&
      isPublicMember(member) &&
      !SKIPPED_METHODS.has(member.name.getText())
  );
}

/** A class's own methods, plus those of the abstract bases it extends. */
function methodsOf(declaration: ts.ClassDeclaration) {
  const methods = new Map<string, ts.MethodDeclaration>();
  let current: ts.ClassDeclaration | undefined = declaration;
  while (current) {
    for (const method of publicMethods(current))
      if (!methods.has(method.name.getText()))
        methods.set(method.name.getText(), method);
    const base: ts.ExpressionWithTypeArguments | undefined =
      current.heritageClauses?.find(
        (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword
      )?.types[0];
    const parent: ts.ClassDeclaration | undefined = base
      ? classOf(checker.getTypeAtLocation(base.expression))
      : undefined;
    current =
      parent && hasModifier(parent, ts.ModifierFlags.Abstract)
        ? parent
        : undefined;
  }
  return [...methods.values()];
}

/** Readonly properties and argument-free calls leading to sub-objects. */
function stepsOf(declaration: ts.ClassDeclaration) {
  const steps: { step: PathStep; target: ts.ClassDeclaration }[] = [];
  for (const member of declaration.members) {
    if (!isPublicMember(member) || hasModifier(member, ts.ModifierFlags.Static))
      continue;
    if (
      ts.isPropertyDeclaration(member) &&
      hasModifier(member, ts.ModifierFlags.Readonly)
    ) {
      const type = checker.getTypeAtLocation(member);
      const target = classOf(type);
      if (target && isSubObject(type))
        steps.push({
          step: { name: member.name.getText(), call: false },
          target,
        });
    }
    if (ts.isMethodDeclaration(member) && member.parameters.length === 0) {
      const { returned, sync } = returnShape(member);
      const target = classOf(returned);
      if (sync && target && isSubObject(returned))
        steps.push({
          step: { name: member.name.getText(), call: true },
          target,
        });
    }
  }
  return steps;
}

function lowerFirst(name: string) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function groupOf(declaration: ts.ClassDeclaration) {
  const path = relative(`${sdkRoot}src`, declaration.getSourceFile().fileName);
  const [top, directory] = path.split('/');
  // The same entities code mode routes on; the rest is shared plumbing.
  return top === 'entities' &&
    directory &&
    entityDirectories.includes(directory)
    ? directory.replaceAll('-', '_')
    : 'core';
}

const operations: Operation[] = [];
const reached = new Set<ts.ClassDeclaration>();
const RESERVED_INPUTS = new Set(['op', 'maxItems']);

function addOperations(
  declaration: ts.ClassDeclaration,
  receiver: Operation['receiver'],
  prefix: string,
  group: string
) {
  reached.add(declaration);
  if (excludedReason(declaration)) return;
  const navigation = new Set(
    stepsOf(declaration)
      .filter(({ step }) => step.call)
      .map(({ step }) => step.name)
  );
  for (const method of methodsOf(declaration)) {
    if (excludedReason(method)) continue;
    const methodName = method.name.getText();
    const name = `${prefix}.${methodName}`;
    const owner = method.parent;
    const where = `${ts.isClassDeclaration(owner) ? className(owner) : prefix}.${methodName}`;
    const hints = hintsOf(where, method);
    if (navigation.has(methodName) || !hints) continue;

    // A synchronous call returning a handle only builds it (`thread.channel()`);
    // MCP callers address that handle directly.
    const shape = returnShape(method);
    const built = classOf(shape.returned);
    if (shape.sync && built && staticById(built)) continue;

    const signatures = checker.getSignaturesOfType(
      checker.getTypeAtLocation(method),
      ts.SignatureKind.Call
    );
    if (signatures.length > 1) {
      errors.add(
        `${where}: overloaded; MCP needs one signature (or @mcp-exclude)`
      );
      continue;
    }

    const failures: string[] = [];
    const parameters: Parameter[] = method.parameters.map((parameter) => {
      const parameterName = parameter.name.getText();
      const rest = parameter.dotDotDotToken !== undefined;
      const type = checker.getTypeAtLocation(parameter);
      const nested: string[] = [];
      const schema = convert(nonUndefined(type), nested);
      failures.push(...nested.map((failure) => `${parameterName}: ${failure}`));
      const text = ts
        .getJSDocParameterTags(parameter)
        .map((tag) => ts.getTextOfJSDocComment(tag.comment) ?? '')
        .join(' ')
        .trim();
      if (!ts.isIdentifier(parameter.name))
        failures.push('destructured parameter; name it');
      return {
        name: parameterName,
        schema,
        optional: isOptional(parameter) || rest,
        rest,
        ...(text ? { description: text } : {}),
      };
    });
    const property = receiver.kind === 'handle' ? receiver.property : undefined;
    for (const parameter of parameters)
      if (RESERVED_INPUTS.has(parameter.name) || parameter.name === property)
        failures.push(
          `parameter ${parameter.name} collides with an input MCP reserves`
        );
    if (failures.length) {
      errors.add(`${where}: ${failures.join('; ')}`);
      continue;
    }

    const symbol = checker.getSymbolAtLocation(method.name);
    operations.push({
      name,
      group,
      ...hints,
      description: description(symbol),
      receiver,
      method: methodName,
      parameters,
      iterable: shape.iterable,
    });
  }

  // Namespaces group by their own directory; a handle's sub-objects by the handle's.
  for (const { step, target } of stepsOf(declaration)) {
    const path = [...receiver.path, step];
    const namespace = receiver.kind === 'namespace';
    addOperations(
      target,
      { ...receiver, path },
      namespace && !receiver.path.length ? step.name : `${prefix}.${step.name}`,
      namespace ? groupOf(target) : group
    );
  }
}

const macroFile = program.getSourceFile(`${sdkRoot}src/macro.ts`);
const macroClass = macroFile?.statements.find(
  (statement): statement is ts.ClassDeclaration =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'Macro'
);
if (!macroClass) throw new Error('Macro class not found');

// Namespaces are `Macro`'s readonly properties, recursively.
addOperations(macroClass, { kind: 'namespace', path: [] }, 'macro', 'core');

// Handle classes: every SDK class with a `static byId` and tagged methods.
for (const declaration of sdkClasses) {
  if (reached.has(declaration) || !staticById(declaration)) continue;
  if (!methodsOf(declaration).length && !stepsOf(declaration).length) continue;
  if (!addressable(declaration)) continue;
  const name = className(declaration);
  addOperations(
    declaration,
    { kind: 'handle', class: name, property: lowerFirst(name), path: [] },
    name,
    groupOf(declaration)
  );
}

// Every class with public methods must be reachable or excluded.
for (const declaration of sdkClasses) {
  if (reached.has(declaration) || excludedReason(declaration)) continue;
  if (hasModifier(declaration, ts.ModifierFlags.Abstract)) continue;
  // Plumbing under src/utils is not part of the public surface.
  if (
    groupOf(declaration) === 'core' &&
    !declaration.getSourceFile().fileName.includes('/src/events/')
  )
    continue;
  const offered = publicMethods(declaration).filter(
    (method) => !excludedReason(method)
  );
  if (!offered.length) continue;
  const name = className(declaration);
  errors.add(
    `${name}: no operation can reach its methods (${offered
      .map((method) => method.name.getText())
      .join(
        ', '
      )}) because ${unaddressable.get(name) ?? 'nothing returns it as a property or argument-free call'}; add a static byId or @mcp-exclude the class`
  );
}

const seen = new Set<string>();
for (const operation of operations) {
  if (seen.has(operation.name))
    errors.add(`duplicate operation ${operation.name}`);
  seen.add(operation.name);
}

// What each group is for: its entity's one `@routing` sentence.
const groups: Record<string, string> = {};
for (const declaration of sdkClasses) {
  const routing = /@routing\s+([^@]*?)\s*(?:\n\s*\*\s*@|\*\/)/s
    .exec(docText(declaration))?.[1]
    ?.replace(/\s*\n\s*\*\s*/g, ' ')
    .trim();
  if (routing) groups[groupOf(declaration)] ??= routing;
}
for (const operation of operations)
  if (!groups[operation.group])
    errors.add(`group ${operation.group} has no @routing sentence`);

if (errors.size) {
  console.error(`${errors.size} SDK methods can't become MCP operations:`);
  for (const error of [...errors].sort()) console.error(`  ${error}`);
  process.exit(1);
}

const catalog: Catalog = {
  groups: Object.fromEntries(
    Object.entries(groups).sort(([left], [right]) => left.localeCompare(right))
  ),
  operations: operations.sort((left, right) =>
    left.name.localeCompare(right.name)
  ),
  handles: Object.fromEntries(
    [...handles].sort(([left], [right]) => left.localeCompare(right))
  ),
  definitions: Object.fromEntries(
    [...definitions].sort(([left], [right]) => left.localeCompare(right))
  ),
};

// Both groupings must name every tool uniquely.
buildTools(catalog, 'entity');
buildTools(catalog, 'method');

const imports = [...handleDeclarations]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([name, declaration]) => {
    const file = relative(
      dirname(outputPath),
      declaration.getSourceFile().fileName
    ).replace(/\.ts$/, '');
    return `import { ${name} } from '${file}';`;
  });

const output = `// Generated by scripts/generate.ts from packages/sdk. Do not edit.

import type { Catalog } from '../catalog';
${imports.join('\n')}

/** Each handle class's constructor, by name. */
export const handleClasses = {
${[...handleDeclarations.keys()]
  .sort()
  .map((name) => `  ${name},`)
  .join('\n')}
};

export const catalog: Catalog = ${JSON.stringify(catalog, null, 2)};
`;

await Bun.write(outputPath, output);

console.log(
  `${operations.length} operations over ${handles.size} handle classes`
);
