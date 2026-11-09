import { createHash } from 'node:crypto';
import ts from 'typescript';

export interface HostMeasurement {
  readonly source: string;
  readonly apiMethods: readonly string[];
}

// AST inventory from the reviewed production dispatcher, using pinned TS 6.0.3.
export const HOST_BODY_SHA256 =
  '564fa6318fa178f37069b9c17abb0d3c6b85694c76d91553e9b7ae97c43c635c';
const method = 'dispatchCompatibilityHost';

type Shape = readonly [number, string | readonly Shape[]];
function fingerprint(body: ts.Block, file: ts.SourceFile): string {
  function shape(node: ts.Node): Shape {
    const children: Shape[] = [];
    ts.forEachChild(node, (child) => {
      children.push(shape(child));
    });
    return [node.kind, children.length === 0 ? node.getText(file) : children];
  }
  return createHash('sha256')
    .update(JSON.stringify(shape(body)))
    .digest('hex');
}

function uint8(type: ts.TypeNode | undefined): boolean {
  return (
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'Uint8Array' &&
    type.typeArguments === undefined
  );
}

function signature(fn: ts.FunctionDeclaration): boolean {
  const [slot, bytes] = fn.parameters;
  return (
    fn.modifiers?.length === 1 &&
    fn.modifiers[0].kind === ts.SyntaxKind.ExportKeyword &&
    fn.asteriskToken === undefined &&
    fn.typeParameters === undefined &&
    fn.parameters.length === 2 &&
    ts.isIdentifier(slot.name) &&
    slot.name.text === 'hostSlot' &&
    slot.type?.kind === ts.SyntaxKind.NumberKeyword &&
    ts.isIdentifier(bytes.name) &&
    bytes.name.text === 'bytes' &&
    uint8(bytes.type) &&
    fn.parameters.every(
      (parameter) =>
        parameter.modifiers === undefined &&
        parameter.dotDotDotToken === undefined &&
        parameter.questionToken === undefined &&
        parameter.initializer === undefined
    ) &&
    uint8(fn.type)
  );
}

/** Diagnostic source overlay only; disabled output is the untouched shipping source. */
export function instrumentCompatibilityHost(
  source: string,
  runtimeImport: string,
  enabled: boolean
): HostMeasurement {
  if (!enabled) return { source, apiMethods: [] };
  if (runtimeImport.length === 0)
    throw new Error('Host instrumentation requires a runtime import');
  const diagnostics = ts.transpileModule(source, {
    fileName: 'host.ts',
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
    },
  }).diagnostics;
  if (
    diagnostics?.some((entry) => entry.category === ts.DiagnosticCategory.Error)
  )
    throw new Error('Invalid host source syntax');
  const file = ts.createSourceFile(
    'host.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  let collision = false;
  function inspect(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === '__audit') collision = true;
    ts.forEachChild(node, inspect);
  }
  inspect(file);
  if (collision) throw new Error('Host source already uses the audit binding');
  const candidates = file.statements.filter(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === method
  );
  if (candidates.length !== 1)
    throw new Error('Expected exactly one direct host dispatcher declaration');
  for (const node of file.statements)
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.some((entry) => entry.name.text === method)
    )
      throw new Error('Host dispatcher has an additional export binding');
  const fn = candidates[0];
  if (!signature(fn) || fn.body === undefined)
    throw new Error('Unsupported host dispatcher signature');
  const body = fn.body.getText(file);
  if (fingerprint(fn.body, file) !== HOST_BODY_SHA256)
    throw new Error('Unreviewed host dispatcher body');
  const wrapped = `{
  return __audit.measureApi('${method}', 'wasm-to-js', 'operation', () => ${body});
}`;
  return {
    source:
      source.slice(0, fn.body.getStart(file)) +
      wrapped +
      source.slice(fn.body.end) +
      `\nimport * as __audit from ${JSON.stringify(runtimeImport)};\n`,
    apiMethods: [method],
  };
}
