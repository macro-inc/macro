import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { Plugin } from 'vite';

/** Insert a membrane at imports made by tests, including relative/deep imports. */
export function membranePlugin(): Plugin {
  const membrane = fileURLToPath(new URL('./membrane.ts', import.meta.url));
  return {
    name: 'lexical-record-membrane',
    enforce: 'pre',
    async transform(code, id) {
      const original = code;
      if (
        process.env.LEXICAL_MACRO === '1' &&
        /\/lexical-markdown\/src\/(MarkdownTransformers|utils)\.ts$/.test(id)
      )
        code = code.replace(
          'const LIST_INDENT_SIZE = 4;',
          'const LIST_INDENT_SIZE = 2;'
        );
      if (
        (process.env.LEXICAL_ORACLE === 'production' ||
          process.env.LEXICAL_REPLAY_ONLY === '1') &&
        id.includes('/lexical-upstream/packages/') &&
        !id.includes('/__tests__/')
      ) {
        const replaced = code
          .replaceAll("process.env.NODE_ENV !== 'production'", 'false')
          .replaceAll("process.env.NODE_ENV === 'production'", 'true');
        if (replaced !== code) return { code: replaced, map: null };
      }
      if (
        process.env.LEXICAL_REPLAY_ONLY === '1' ||
        !(id.includes('/__tests__/') || id.includes('/lexical-core/tests/')) ||
        id.includes('/lexical-conformance/')
      )
        return code === original ? undefined : { code, map: null };
      const source = ts.createSourceFile(
        id,
        code,
        ts.ScriptTarget.Latest,
        true,
        id.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );
      const edits: { start: number; end: number; text: string }[] = [];
      const awaitBoundary = (node: ts.Node) => {
        if (
          ts.isAwaitExpression(node) &&
          ts.isCallExpression(node.expression) &&
          ts.isPropertyAccessExpression(node.expression.expression) &&
          node.expression.expression.name.text === 'update'
        ) {
          edits.push({
            start: node.getStart(source),
            end: node.getStart(source),
            text: "((__lexAwaited) => { globalThis.__lexRec?.tick('await'); return __lexAwaited; })(",
          });
          edits.push({ start: node.end, end: node.end, text: ')' });
        }
        if (ts.isCallExpression(node)) {
          const callee = node.expression.getText(source);
          if (
            /^(test|it)(?:\.|\()/.test(callee) ||
            /^(test|it)$/.test(callee)
          ) {
            for (const arg of node.arguments) {
              if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
                edits.push({
                  start: arg.getStart(source),
                  end: arg.getStart(source),
                  text: '__lexBody(',
                });
                edits.push({ start: arg.end, end: arg.end, text: ')' });
              }
            }
          }
        }
        if (
          ts.isPropertyAccessExpression(node) &&
          /^(innerHTML|outerHTML|textContent|childNodes|children|firstChild|lastChild|querySelector|querySelectorAll|getBoundingClientRect|style|className)$/.test(
            node.name.text
          )
        ) {
          edits.push({
            start: node.expression.getStart(source),
            end: node.expression.getStart(source),
            text: '__lexDOM(',
          });
          edits.push({
            start: node.expression.end,
            end: node.expression.end,
            text: ')',
          });
        }
        ts.forEachChild(node, awaitBoundary);
      };
      awaitBoundary(source);
      let serial = 0;
      for (const node of source.statements) {
        if (process.env.LEXICAL_MEMBRANE === 'off') break;
        if (
          !ts.isImportDeclaration(node) ||
          !ts.isStringLiteral(node.moduleSpecifier) ||
          !node.importClause ||
          node.importClause.isTypeOnly
        )
          continue;
        const specifier = node.moduleSpecifier.text;
        const resolved = await this.resolve(specifier, id, { skipSelf: true });
        if (
          !resolved?.id.includes('/packages/') ||
          !(
            resolved.id.includes('/src/') ||
            resolved.id.includes('/lexical-core/')
          ) ||
          !resolved.id.includes('/lexical')
        )
          continue;
        if (
          specifier.startsWith('@lexical/react') &&
          specifier !== '@lexical/react/LexicalTabIndentationPlugin'
        )
          continue;
        const location =
          resolved.id.match(
            /\/packages\/(lexical-core)\/(.+?)\.[cm]?[jt]sx?$/
          ) ??
          resolved.id.match(
            /\/packages\/(lexical[^/]*)\/src\/(.+?)\.[cm]?[jt]sx?$/
          );
        if (!location) continue;
        const packageName =
          location[1] === 'lexical-core'
            ? '@macro-inc/lexical-core'
            : location[1] === 'lexical'
              ? 'lexical'
              : `@lexical/${location[1].slice(8)}`;
        const relative = location[2].replace(/\/index$/, '');
        const name =
          relative === 'index' ? packageName : `${packageName}/${relative}`;
        const namespace = `__lexModule${serial++}`;
        const bindings = node.importClause.namedBindings;
        const lines = [
          `import * as ${namespace} from ${JSON.stringify(specifier)};`,
        ];
        if (node.importClause.name)
          lines.push(
            `const ${node.importClause.name.text} = __lexWrap(${namespace}, ${JSON.stringify(name)}).default;`
          );
        if (bindings && ts.isNamedImports(bindings)) {
          const names = bindings.elements
            .filter((element) => !element.isTypeOnly)
            .map(
              (element) =>
                `${element.propertyName?.text ?? element.name.text}: ${element.name.text}`
            );
          lines.push(
            `const {${names.join(',')}} = __lexWrap(${namespace}, ${JSON.stringify(name)});`
          );
        } else if (bindings && ts.isNamespaceImport(bindings))
          lines.push(
            `const ${bindings.name.text} = __lexWrap(${namespace}, ${JSON.stringify(name)});`
          );
        edits.push({
          start: node.getStart(source),
          end: node.end,
          text: lines.join('\n'),
        });
      }
      if (!edits.length)
        return code === original ? undefined : { code, map: null };
      let result = code;
      for (const edit of edits.sort((a, b) => b.start - a.start))
        result =
          result.slice(0, edit.start) + edit.text + result.slice(edit.end);
      return {
        code: `import {wrapModule as __lexWrap, testBody as __lexBody, modelDOM as __lexDOM} from ${JSON.stringify(membrane)};\n${result}`,
        map: null,
      };
    },
  };
}
