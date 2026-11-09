import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { AliasOptions, Plugin } from 'vite';

const defaultSource = fileURLToPath(
  new URL('../../../../node_modules/lexical/src/', import.meta.url)
);
const compat = fileURLToPath(new URL('./', import.meta.url));
/** Tests only: retain upstream dependency edges and delegate DOM exports. */
export function compatSourcePlugin(
  upstream: boolean,
  sourceRoot = defaultSource
): Plugin {
  const source = resolve(sourceRoot);
  const modules: Record<string, string> = {
    LexicalReconciler: 'reconciler',
    LexicalEvents: 'events',
    LexicalMutations: 'mutations',
    LexicalDOMSlot: 'dom-slot',
  };
  return {
    name: 'compat-upstream-dom-oracle',
    enforce: 'pre',
    resolveId(id, importer) {
      if (upstream || !importer) return;
      if (importer.split('?')[0].startsWith(compat) && id === './environment') {
        return resolve(source, 'environment.ts');
      }
      const target = resolve(dirname(importer.split('?')[0]), id).replace(
        /\.tsx?$/,
        ''
      );
      if (dirname(target) === source && modules[basename(target)])
        return `${target}.ts`;
    },
    transform(code, id) {
      const file = id.split('?')[0];
      if (dirname(file) !== source) return;
      const name = basename(file, '.ts');
      if (name === 'LexicalEditor') {
        const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
        const declaration = ast.statements.find(
          (st): st is ts.FunctionDeclaration =>
            ts.isFunctionDeclaration(st) && st.name?.text === 'createEditor'
        );
        if (!declaration?.body)
          throw new Error('Pinned createEditor declaration is missing');
        const imports = `
import * as oracleModel from '${source}/index.ts';
import {installUpstreamRuntime as installOracle} from '${compat}test-setup.ts';
import {RangeSelection as OracleRangeSelection} from '${source}/LexicalSelection.ts';
import {getActiveEditor as oracleEditor,getActiveEditorState as oracleState,isCurrentlyReadOnlyMode as oracleReadOnly,updateEditorSync as oracleSync} from '${source}/LexicalUpdates.ts';
import {$getCompositionKey as oracleComposition} from '${source}/LexicalUtils.ts';
import {createEmptyEditorState as oracleEmpty} from '${source}/LexicalEditorState.ts';
`;
        const position = declaration.body.getStart(ast) + 1;
        const initialize = `installOracle(oracleModel,{RangeSelection:OracleRangeSelection,getActiveEditor:oracleEditor,getActiveEditorState:oracleState,isCurrentlyReadOnlyMode:oracleReadOnly,updateEditorSync:oracleSync,$getCompositionKey:oracleComposition,createEmptyEditorState:oracleEmpty});`;
        return (
          code.slice(0, position) + initialize + code.slice(position) + imports
        );
      }
      if (upstream) return;
      if (name === 'LexicalSelection') {
        const names = new Set([
          '$internalCreateSelection',
          '$createRangeSelectionFromDom',
          '$internalCreateRangeSelection',
          '$updateDOMSelection',
        ]);
        const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
        const edits = ast.statements.filter(
          (st) => ts.isFunctionDeclaration(st) && names.has(st.name?.text ?? '')
        );
        let next = code;
        for (const st of edits.reverse())
          next = next.slice(0, st.getFullStart()) + next.slice(st.end);
        return `import {${[...names].join(',')}} from '${compat}selection.ts';\nexport {${[...names].join(',')}};\n${next}`;
      }
      const port = modules[name];
      if (!port) return;
      const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
      const names: string[] = [];
      const edits: ts.Modifier[] = [];
      for (const st of ast.statements) {
        if (
          !ts.isFunctionDeclaration(st) &&
          !ts.isClassDeclaration(st) &&
          !ts.isVariableStatement(st)
        )
          continue;
        const modifier = st.modifiers?.find(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword
        );
        if (!modifier) continue;
        edits.push(modifier);
        if (ts.isVariableStatement(st))
          for (const declaration of st.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name))
              names.push(declaration.name.text);
          }
        else if (st.name) names.push(st.name.text);
      }
      let next = code;
      for (const modifier of edits.reverse())
        next = next.slice(0, modifier.getStart(ast)) + next.slice(modifier.end);
      return `${next}\nexport {${names.join(',')}} from '${compat}${port}.ts';\n`;
    },
  };
}
export const upstreamAliases: AliasOptions = [
  {
    find: /^@lexical\/([^/]+)$/,
    replacement: fileURLToPath(
      new URL(
        '../../../../node_modules/@lexical/$1/src/index.ts',
        import.meta.url
      )
    ),
  },
  { find: /^lexical$/, replacement: `${defaultSource}index.ts` },
  { find: /^@upstream\/(.*)$/, replacement: `${defaultSource}$1.ts` },
];
