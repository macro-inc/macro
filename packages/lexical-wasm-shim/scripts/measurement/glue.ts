import ts from 'typescript';
import { type AbiSignature, type ModuleAbi, widths } from './abi';

export interface GlueMeasurement {
  readonly source: string;
  readonly apiMethods: readonly string[];
  readonly physicalImports: readonly string[];
  readonly physicalExports: readonly string[];
  readonly payloadHelpers: readonly string[];
}
interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}
const fixed = new Set(['compatFlush', 'compatCommit']);
const inboundPayloadHelpers = new Set([
  'passArray8ToWasm0',
  'passStringToWasm0',
]);
const outboundPayloadHelpers = new Set([
  'decodeText',
  'getArrayJsValueFromWasm0',
]);
function physical(
  name: string,
  direction: string,
  type: AbiSignature,
  body: string
): string {
  const input = widths(type.parameters);
  const output = widths(type.results);
  return `__audit.measurePhysical(${JSON.stringify(name)}, ${JSON.stringify(direction)}, ${input.bytes}, ${output.bytes}, ${input.refs}, ${output.refs}, () => ${body})`;
}

/** Explicit diagnostic build transform. Disabled builds retain the exact original bytes. */
export function instrumentGlue(
  source: string,
  abi: ModuleAbi,
  runtimeImport: string,
  enabled: boolean
): GlueMeasurement {
  if (!enabled)
    return {
      source,
      apiMethods: [],
      physicalImports: [],
      physicalExports: [],
      payloadHelpers: [],
    };
  if (source.includes('__audit'))
    throw new Error('Glue was already instrumented');
  const file = ts.createSourceFile(
    'session.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const edits: Edit[] = [];
  const apiMethods: string[] = [];
  const physicalImports: string[] = [];
  const physicalExports: string[] = [];
  const payloadHelpers: string[] = [];
  const imports = new Map(abi.imports.map((entry) => [entry.name, entry]));
  if (imports.size !== abi.imports.length)
    throw new Error('Ambiguous WASM import names');
  let byteCopies = 0;
  let finalizers = 0;
  let importReturns = 0;
  const tableBindings = new Map<ts.Node, Map<string, string | null>>();
  function scope(node: ts.Node): ts.Node {
    if (ts.isSourceFile(node) || ts.isFunctionLike(node)) return node;
    return node.parent === undefined ? file : scope(node.parent);
  }
  function directTable(node: ts.Node): string | undefined {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.getText(file) === 'wasm' &&
      abi.tables.includes(node.name.text)
    )
      return node.name.text;
    return undefined;
  }
  function bindings(node: ts.Node): void {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name)
    ) {
      const owner = scope(node);
      const map = tableBindings.get(owner) ?? new Map<string, string | null>();
      const target =
        node.initializer === undefined
          ? null
          : (directTable(node.initializer) ?? null);
      if (
        map.has(node.name.text) &&
        (map.get(node.name.text) !== null || target !== null)
      )
        throw new Error('Ambiguous exported table binding or shadowing');
      map.set(node.name.text, target);
      tableBindings.set(owner, map);
    }
    ts.forEachChild(node, bindings);
  }
  bindings(file);
  function table(node: ts.Node): string | undefined {
    const direct = directTable(node);
    if (direct !== undefined || !ts.isIdentifier(node)) return direct;
    let owner: ts.Node | undefined = node;
    while (owner !== undefined) {
      const map = tableBindings.get(owner);
      if (map?.has(node.text)) return map.get(node.text) ?? undefined;
      owner = owner.parent;
    }
    return undefined;
  }
  function insert(position: number, text: string): void {
    edits.push({ start: position, end: position, text });
  }
  function wrapBody(body: ts.Block, prefix: string): void {
    insert(body.getStart(file) + 1, `return ${prefix}(() => {`);
    insert(body.end - 1, '});');
  }
  function containsWasm(node: ts.Node): boolean {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.getText(file) === 'wasm'
    )
      return true;
    return ts.forEachChild(node, containsWasm) ?? false;
  }
  function checkMemoryExportAccess(node: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.getText(file) === 'wasm' &&
      node.name.text === 'memory'
    ) {
      const owner = scope(node);
      if (
        !ts.isFunctionDeclaration(owner) ||
        !['getDataViewMemory0', 'getUint8ArrayMemory0'].includes(
          owner.name?.text ?? ''
        )
      )
        throw new Error('Unaccounted direct WASM memory access');
    }
  }
  function instrumentFunctionDeclaration(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name !== undefined &&
      node.body !== undefined
    ) {
      const method = node.name.text;
      if (method === '__wbg_finalize_init') {
        const statement = node.body.statements.find(
          (entry) =>
            ts.isExpressionStatement(entry) &&
            ts.isBinaryExpression(entry.expression) &&
            entry.expression.left.getText(file) === 'wasm' &&
            entry.expression.right.getText(file) === 'instance.exports'
        );
        if (statement === undefined)
          throw new Error('Missing native exports binding');
        const members = Object.entries(abi.exports).map(([name, type]) => {
          const params = type.parameters.map((_, i) => `arg${i}`).join(', ');
          physicalExports.push(name);
          return `[${JSON.stringify(name)}]: function(${params}) { return ${physical(name, 'js-to-wasm', type, `instance.exports[${JSON.stringify(name)}](${params})`)}; }`;
        });
        edits.push({
          start: statement.getStart(file),
          end: statement.end,
          text: `wasm = { ...instance.exports, ${members.join(',\n')} };`,
        });
        finalizers++;
      } else if (method === '__wbg_get_imports') {
        for (const statement of node.body.statements) {
          if (
            !ts.isReturnStatement(statement) ||
            statement.expression === undefined ||
            !ts.isObjectLiteralExpression(statement.expression)
          )
            continue;
          const assignments: string[] = [];
          for (const member of statement.expression.properties) {
            if (
              !ts.isPropertyAssignment(member) ||
              !ts.isStringLiteral(member.name)
            )
              continue;
            const module = member.name.text;
            const object = member.initializer.getText(file);
            const required = abi.imports.filter(
              (entry) => entry.module === module
            );
            for (const entry of required) {
              const params = entry.parameters
                .map((_, i) => `arg${i}`)
                .join(', ');
              const original = `${object}[${JSON.stringify(entry.name)}]`;
              // Preserve original function receiver/arguments, including handleError wrappers.
              assignments.push(
                `{ const original = ${original}; ${original} = function(${params}) { return ${physical(`${module}:${entry.name}`, 'wasm-to-js', entry, 'original.apply(this, arguments)')}; }; }`
              );
              physicalImports.push(entry.name);
            }
          }
          insert(statement.getStart(file), assignments.join('\n'));
          importReturns++;
        }
      } else if (inboundPayloadHelpers.has(method)) {
        payloadHelpers.push(method);
        function returns(child: ts.Node): void {
          if (ts.isReturnStatement(child)) {
            insert(
              child.getStart(file),
              `__audit.measureBuffer('js-to-wasm', '${method}', WASM_VECTOR_LEN);`
            );
            return;
          }
          ts.forEachChild(child, returns);
        }
        returns(node.body);
      } else if (outboundPayloadHelpers.has(method)) {
        payloadHelpers.push(method);
        insert(
          node.body.getStart(file) + 1,
          `__audit.measureBuffer('wasm-to-js', '${method}', len${method === 'getArrayJsValueFromWasm0' ? ' * 4' : ''});`
        );
      } else if (
        /^(?:passArray|getArray)/.test(method) &&
        method !== 'getArrayU8FromWasm0'
      ) {
        throw new Error(`Unaccounted payload helper: ${method}`);
      }
    }
  }
  function instrumentClassMethods(node: ts.Node): void {
    if (ts.isClassDeclaration(node) && node.name !== undefined) {
      for (const member of node.members) {
        if (
          !ts.isMethodDeclaration(member) ||
          member.body === undefined ||
          !containsWasm(member.body)
        )
          continue;
        if (!ts.isIdentifier(member.name))
          throw new Error('Unsupported generated API method');
        const method = member.name.text;
        const qualified = `${node.name.text}.${method}`;
        if (method === 'compatBatch') {
          const request = member.parameters[0]?.name.getText(file);
          if (request === undefined)
            throw new Error('Missing generated batch request');
          wrapBody(
            member.body,
            `__audit.measureBatchApi.bind(null, ${JSON.stringify(qualified)}, ${request})`
          );
        } else
          wrapBody(
            member.body,
            `__audit.measureApi.bind(null, ${JSON.stringify(qualified)}, ${JSON.stringify(fixed.has(method) ? 'fixed' : 'operation')})`
          );
        apiMethods.push(qualified);
      }
    }
  }
  function instrumentExportedFunction(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name !== undefined &&
      node.body !== undefined &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      ) &&
      containsWasm(node.body)
    ) {
      const method = node.name.text;
      wrapBody(
        node.body,
        `__audit.measureApi.bind(null, ${JSON.stringify(method)}, 'operation')`
      );
      apiMethods.push(method);
    }
  }
  function instrumentTableOperation(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      table(node.expression.expression) !== undefined
    ) {
      const exported = table(node.expression.expression);
      const method = node.expression.name.text;
      if (method === 'get' || method === 'set') {
        const direction = method === 'get' ? 'wasm-to-js' : 'js-to-wasm';
        insert(
          node.getStart(file),
          `__audit.measureTableReference('${direction}', ${JSON.stringify(`${exported}.${method}`)}, () => `
        );
        insert(node.end, ')');
      } else if (method !== 'grow' || node.arguments.length > 1)
        throw new Error(`Unaccounted table operation: ${method}`);
    }
  }
  function checkMemoryHelperContext(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ['getDataViewMemory0', 'getUint8ArrayMemory0'].includes(
        node.expression.text
      )
    ) {
      const owner = scope(node);
      const ownerName = ts.isFunctionDeclaration(owner)
        ? owner.name?.text
        : undefined;
      const known = [
        'getArrayJsValueFromWasm0',
        'getArrayU8FromWasm0',
        'passArray8ToWasm0',
        'passStringToWasm0',
        'decodeText',
      ];
      const setter =
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name.text.startsWith('set') &&
        ts.isCallExpression(node.parent.parent) &&
        node.expression.text === 'getDataViewMemory0';
      if (!setter && (ownerName === undefined || !known.includes(ownerName)))
        throw new Error(
          'Unaccounted shared-memory access outside known payload helpers'
        );
    }
  }
  function instrumentMemoryWrite(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(file) === 'getDataViewMemory0()'
    ) {
      const method = node.expression.name.text;
      const sizes: Readonly<Record<string, number>> = {
        setInt8: 1,
        setUint8: 1,
        setInt16: 2,
        setUint16: 2,
        setInt32: 4,
        setUint32: 4,
        setFloat32: 4,
        setFloat64: 8,
        setBigInt64: 8,
        setBigUint64: 8,
      };
      if (method.startsWith('set')) {
        const size = sizes[method];
        if (size === undefined)
          throw new Error(`Unaccounted memory write: ${method}`);
        insert(
          node.getStart(file),
          `__audit.measureMemoryWrite('shared-memory.${method}', ${size}, () => `
        );
        insert(node.end, ')');
      }
    }
  }
  function instrumentFinalizer(node: ts.Node): void {
    if (
      ts.isArrowFunction(node) &&
      ts.isNewExpression(node.parent) &&
      node.parent.expression.getText(file) === 'FinalizationRegistry' &&
      ts.isCallExpression(node.body) &&
      ts.isPropertyAccessExpression(node.body.expression) &&
      node.body.expression.expression.getText(file) === 'wasm'
    ) {
      const method = `FinalizationRegistry.${node.body.expression.name.text}`;
      insert(
        node.body.getStart(file),
        `__audit.measureApi(${JSON.stringify(method)}, 'operation', () => `
      );
      insert(node.body.end, ')');
      apiMethods.push(method);
    }
  }
  let byteCopyChecker: ts.TypeChecker | undefined;
  function validateByteCopy(
    node: ts.CallExpression,
    copy: ts.NewExpression
  ): void {
    if (byteCopyChecker === undefined) {
      const options: ts.CompilerOptions = {
        allowJs: true,
        noLib: true,
        noResolve: true,
      };
      const host = ts.createCompilerHost(options);
      host.getSourceFile = (name) =>
        name === file.fileName ? file : undefined;
      const program = ts.createProgram([file.fileName], options, host);
      if (program.getSourceFile(file.fileName) !== file)
        throw new Error('Byte-copy binding source was not resolved');
      byteCopyChecker = program.getTypeChecker();
    }
    const checker = byteCopyChecker;
    function symbol(node: ts.Node): ts.Symbol {
      const found = checker.getSymbolAtLocation(node);
      if (found === undefined) throw new Error('Unresolved byte-copy binding');
      return found;
    }

    function declaration(name: string): ts.FunctionDeclaration {
      const found = file.statements.filter(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && statement.name?.text === name
      );
      if (found.length !== 1 || found[0].body === undefined)
        throw new Error(`Unreviewed byte-copy helper binding: ${name}`);
      return found[0];
    }
    function shape(source: string): string {
      const parsed = ts.createSourceFile(
        'byte-helper.js',
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
      );
      type Shape = readonly [number, string | readonly Shape[]];
      function visit(node: ts.Node): Shape {
        const children: Shape[] = [];
        ts.forEachChild(node, (child) => {
          children.push(visit(child));
        });
        return [
          node.kind,
          children.length === 0 ? node.getText(parsed) : children,
        ];
      }
      return JSON.stringify(visit(parsed));
    }
    function validateHelpers(): void {
      const view = declaration('getArrayU8FromWasm0');
      const memory = declaration('getUint8ArrayMemory0');
      if (view.name === undefined || memory.name === undefined)
        throw new Error('Missing byte-copy helper names');
      if (
        shape(view.getText(file)) !==
          shape(
            'function getArrayU8FromWasm0(ptr, len) { ptr = ptr >>> 0; return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len); }'
          ) ||
        shape(memory.getText(file)) !==
          shape(
            'function getUint8ArrayMemory0() { if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) { cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer); } return cachedUint8ArrayMemory0; }'
          ) ||
        symbol(node.expression) !== symbol(view.name)
      )
        throw new Error(
          'Unreviewed byte-copy memory helper or shadowed binding'
        );
      function requireBinding(
        root: ts.Node,
        name: string,
        expected?: ts.Symbol
      ): void {
        function visit(child: ts.Node): void {
          if (
            ts.isIdentifier(child) &&
            child.text === name &&
            checker.getSymbolAtLocation(child) !== expected
          )
            throw new Error(`Shadowed byte-copy binding: ${name}`);
          ts.forEachChild(child, visit);
        }
        visit(root);
      }
      const memorySymbol = symbol(memory.name);
      requireBinding(view, 'getUint8ArrayMemory0', memorySymbol);
      requireBinding(copy, 'Uint8Array');
      requireBinding(memory, 'Uint8Array');
      for (const name of ['wasm', 'cachedUint8ArrayMemory0']) {
        const declarations = file.statements
          .flatMap((statement) =>
            ts.isVariableStatement(statement)
              ? [...statement.declarationList.declarations]
              : []
          )
          .filter(
            (item) => ts.isIdentifier(item.name) && item.name.text === name
          );
        if (declarations.length !== 1)
          throw new Error(`Missing exact byte-copy memory binding: ${name}`);
        const initial = declarations[0].initializer;
        if (
          name === 'cachedUint8ArrayMemory0'
            ? initial?.kind !== ts.SyntaxKind.NullKeyword
            : initial !== undefined
        )
          throw new Error(`Unreviewed byte-copy memory initializer: ${name}`);
        requireBinding(memory, name, symbol(declarations[0].name));
      }
    }
    validateHelpers();
    const owner = scope(node);
    if (
      !ts.isFunctionExpression(owner) ||
      owner.parameters.length !== 2 ||
      owner.asteriskToken !== undefined ||
      owner.modifiers?.length
    )
      throw new Error('Unsupported byte-copy import function');
    validateImport(owner);
    function validateImport(owner: ts.FunctionExpression): void {
      const property = owner.parent;
      if (
        !ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
      )
        throw new Error('Missing byte-copy import property');
      const abiImport = imports.get(property.name.text);
      const binding = property.parent.parent;
      const factory = scope(binding);
      if (
        !abiImport ||
        abiImport.parameters.join(',') !== 'i32,i32' ||
        abiImport.results.join(',') !== 'externref' ||
        !ts.isVariableDeclaration(binding) ||
        binding.initializer !== property.parent ||
        !ts.isIdentifier(binding.name) ||
        !ts.isFunctionDeclaration(factory) ||
        factory.name?.text !== '__wbg_get_imports' ||
        factory.body === undefined
      )
        throw new Error(
          'Byte-copy direction is not an exact WASM-to-JS ABI import'
        );
      const moduleMatches = factory.body.statements.some(
        (statement) =>
          ts.isReturnStatement(statement) &&
          statement.expression !== undefined &&
          ts.isObjectLiteralExpression(statement.expression) &&
          statement.expression.properties.some(
            (entry) =>
              ts.isPropertyAssignment(entry) &&
              ts.isStringLiteral(entry.name) &&
              entry.name.text === abiImport.module &&
              ts.isIdentifier(entry.initializer) &&
              symbol(entry.initializer) === symbol(binding.name)
          )
      );
      if (!moduleMatches)
        throw new Error('Byte-copy module does not match binary ABI');
      validateArguments();
      function validateArguments(): void {
        for (let index = 0; index < 2; index++) {
          const parameter = owner.parameters[index];
          const argument = node.arguments[index];
          if (
            !ts.isIdentifier(parameter.name) ||
            parameter.initializer ||
            parameter.dotDotDotToken ||
            !argument ||
            !ts.isIdentifier(argument) ||
            symbol(argument) !== symbol(parameter.name)
          )
            throw new Error('Unsupported byte-copy pointer/length bindings');
        }
      }
    }
  }
  function isByteCopy(
    node: ts.CallExpression,
    parent: ts.Node
  ): parent is ts.NewExpression {
    return (
      ts.isNewExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === 'Uint8Array' &&
      parent.arguments?.length === 1 &&
      parent.arguments[0] === node
    );
  }
  function instrumentByteView(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'getArrayU8FromWasm0'
    ) {
      const first = node.arguments[0];
      const length = node.arguments[1];
      if (
        first === undefined ||
        length === undefined ||
        node.arguments.length !== 2
      )
        throw new Error('Unsupported byte view helper');
      const parent = node.parent;
      if (isByteCopy(node, parent)) {
        validateByteCopy(node, parent);
        byteCopies++;
        if (!payloadHelpers.includes('getArrayU8FromWasm0.copy'))
          payloadHelpers.push('getArrayU8FromWasm0.copy');
        insert(
          parent.getStart(file),
          "((__auditCopy) => { __audit.measureBuffer('wasm-to-js', 'getArrayU8FromWasm0.copy', Reflect.apply(__auditByteLength, __auditCopy, [])); return __auditCopy; })("
        );
        insert(parent.end, ')');
      } else if (
        ts.isPropertyAccessExpression(parent) &&
        parent.name.text === 'slice'
      ) {
        insert(
          node.getStart(file),
          `(__audit.measureBuffer('wasm-to-js', 'getArrayU8FromWasm0.slice', ${length.getText(file)}), `
        );
        insert(node.end, ')');
      } else if (
        ts.isVariableDeclaration(parent) &&
        parent.name.getText(file) === 'ret'
      ) {
        insert(
          node.getStart(file),
          `(__audit.measureBuffer('wasm-to-js', 'getArrayU8FromWasm0.borrow', ${length.getText(file)}), `
        );
        insert(node.end, ')');
      } else if (
        ts.isCallExpression(parent) &&
        parent.expression.getText(file) === 'Uint8Array.prototype.set.call' &&
        parent.arguments[0] === node
      ) {
        const from = parent.arguments[1];
        if (from === undefined) throw new Error('Missing byte view source');
        insert(
          parent.getStart(file),
          `(__audit.measureBuffer('js-to-wasm', 'Uint8Array.prototype.set.call', ${from.getText(file)}.length), `
        );
        insert(parent.end, ')');
      } else
        throw new Error(
          `Unaccounted byte view transfer: ${parent.getText(file)}`
        );
    }
  }
  function scan(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === 'getArrayU8FromWasm0') {
      const parent = node.parent;
      const declared = ts.isFunctionDeclaration(parent) && parent.name === node;
      const called = ts.isCallExpression(parent) && parent.expression === node;
      if (!declared && !called)
        throw new Error('Unaccounted byte view helper reference or alias');
    }
    if (table(node) !== undefined) {
      const parent = node.parent;
      const declaration =
        ts.isVariableDeclaration(parent) && parent.name === node;
      const supportedBinding =
        ts.isVariableDeclaration(parent) &&
        parent.initializer === node &&
        ts.isIdentifier(parent.name) &&
        directTable(node) !== undefined;
      const receiver =
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        (parent.name.text === 'length' ||
          (['get', 'set', 'grow'].includes(parent.name.text) &&
            ts.isCallExpression(parent.parent) &&
            parent.parent.expression === parent));
      if (!declaration && !supportedBinding && !receiver)
        throw new Error('Unaccounted exported table reference or alias');
    }
    checkMemoryExportAccess(node);
    instrumentFunctionDeclaration(node);
    instrumentClassMethods(node);
    instrumentExportedFunction(node);
    instrumentTableOperation(node);
    checkMemoryHelperContext(node);
    instrumentMemoryWrite(node);
    instrumentFinalizer(node);
    instrumentByteView(node);
    ts.forEachChild(node, scan);
  }
  scan(file);
  if (
    finalizers !== 1 ||
    importReturns !== 1 ||
    physicalImports.length !== abi.imports.length
  )
    throw new Error('Incomplete generated glue boundary coverage');
  if (new Set(physicalImports).size !== imports.size)
    throw new Error('Duplicate physical import instrumentation');
  for (const helper of ['passArray8ToWasm0', 'passStringToWasm0', 'decodeText'])
    if (!payloadHelpers.includes(helper))
      throw new Error(`Missing expected payload helper: ${helper}`);
  let result = source;
  const sorted = edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let previous = source.length + 1;
  for (const edit of sorted) {
    if (edit.end > previous)
      throw new Error('Overlapping glue instrumentation edits');
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    previous = edit.start;
  }
  const byteLength =
    byteCopies === 0
      ? ''
      : `
const __auditByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')?.get;
if (typeof __auditByteLength !== 'function') throw new Error('Missing intrinsic typed-array byte length');
`;
  result = `import * as __audit from ${JSON.stringify(runtimeImport)};\n${byteLength}${result}`;
  return {
    source: result,
    apiMethods,
    physicalImports,
    physicalExports,
    payloadHelpers,
  };
}
