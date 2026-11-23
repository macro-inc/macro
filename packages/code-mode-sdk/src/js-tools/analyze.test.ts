import { CodeMode } from '@opencode/codemode';
import { Result } from 'codemode-effect';
import { describe, expect, it } from 'vitest';
import { analyze, toolsByPath } from './analyze';
import type { Catalog, CatalogTool } from './catalog';
import { makeRuntime } from './runtime';

function tool(service: string, name: string): CatalogTool {
  return {
    path: [service, name],
    service,
    operationId: name,
    client: service,
    method: name,
    httpMethod: 'POST',
    route: `/${service}/${name}`,
    rivals: [],
    description: `${service} ${name}`,
    input: { type: 'object' },
    output: { type: 'object' },
  };
}

// `search` is also a Macro service: `tools.search.<operation>` is a tool,
// while the bare `search(...)` built-in calls nothing.
const CATALOG: Catalog = {
  tools: [
    tool('tasks', 'create'),
    tool('tasks', 'read'),
    tool('docs', 'del'),
    tool('search', 'query'),
  ],
  defs: {},
  skipped: [],
};
const TOOLS = toolsByPath(CATALOG);

type Expected = 'cannot_analyze' | 'diagnostics' | string[];

// Each program, and what the analysis must say: the operations it may call,
// or a refusal. Every one also runs in the real interpreter, which must call
// nothing outside an `ok` answer.
const CORPUS: Record<string, [string, Expected]> = {
  // The admitted form.
  plain: ['await tools.tasks.read({}); return 1', ['tasks.read']],
  optional: ['await tools?.tasks?.create?.({}); return 1', ['tasks.create']],
  optionalCallOnly: [
    'await tools.tasks.create?.({}); return 1',
    ['tasks.create'],
  ],
  parenthesizedChain: [
    'await (tools?.tasks).create({}); return 1',
    ['tasks.create'],
  ],
  parenthesizedCallee: ['await (tools.docs.del)({}); return 1', ['docs.del']],
  bracket: ['await tools["docs"]["del"]({}); return 1', ['docs.del']],
  unicodeEscapes: [
    'await \\u0074ools["d\\u006fcs"].del({}); return 1',
    ['docs.del'],
  ],
  spreadArguments: ['await tools.docs.del(...[{}]); return 1', ['docs.del']],
  branchNeverTaken: [
    'if (Math.random() > 2) await tools.docs.del({}); return 1',
    ['docs.del'],
  ],
  inFunction: [
    'async function f() { return tools.tasks.create({}) } return await f()',
    ['tasks.create'],
  ],
  inCallback: [
    'return await Promise.all([1, 2].map(() => tools.tasks.read({})))',
    ['tasks.read'],
  ],
  nestedFunctions: [
    'const f = () => () => () => tools.docs.del({}); return await f()()()',
    ['docs.del'],
  ],
  asyncGenerator: [
    'async function* g() { yield await tools.tasks.read({}) } for await (const x of g()) {} return 1',
    ['tasks.read'],
  ],
  toolResultIsData: [
    'const r = await tools.tasks.read({}); return Object.keys(r)',
    ['tasks.read'],
  ],
  macroSearchService: ['return await tools.search.query({})', ['search.query']],
  getterBody: [
    'const o = { get x() { return tools.docs.del({}) } }; return o.x',
    ['docs.del'],
  ],
  keyNamedTools: ['const o = { tools: 1 }; return o.tools', []],
  memberNamedTools: [
    'const o = { tools: { docs: { del: () => 1 } } }; return o.tools.docs.del()',
    [],
  ],
  patternKeyNamedTools: ['const { tools: t } = { tools: 1 }; return t', []],
  memberNamedRequire: ['const o = { require: 1 }; return o.require', []],

  // search is data.
  searchCall: ['return search("del")', []],
  searchAlias: ['const s = search; return await s("del")', []],
  searchNamespace: ['return await search({ namespace: "docs" })', []],
  searchResultPath: [
    'const r = await search("del"); return r.items.map((item) => item.path)',
    [],
  ],
  searchResultCalled: [
    'const r = await search("del"); return await r.items[0].path({})',
    [],
  ],
  toolsSearch: ['return await tools.search("del")', 'cannot_analyze'],

  // require, in every disguise (upstream's scan admits the first five).
  requireAlias: [
    'const r = require; const t = r("tools"); await t.docs.del({}); return 1',
    'cannot_analyze',
  ],
  requireCall: [
    'const t = require.call(null, "tools"); await t.docs.del({})',
    'cannot_analyze',
  ],
  requireApply: [
    'const t = require.apply(null, ["tools"]); await t.docs.del({})',
    'cannot_analyze',
  ],
  requireInArray: [
    'const t = [require][0]("tools"); await t.docs.del({})',
    'cannot_analyze',
  ],
  requireBind: [
    'const g = require.bind(null, "tools"); await g().docs.del({})',
    'cannot_analyze',
  ],
  requireInObject: [
    'const o = { r: require }; return Object.keys(o.r("tools"))',
    'cannot_analyze',
  ],
  requireFromFunction: [
    'function f() { return require } return Object.keys(f()("tools"))',
    'cannot_analyze',
  ],
  requireDefault: [
    'function f(r = require) { return r("tools") } return await f().docs.del({})',
    'cannot_analyze',
  ],
  requireDirect: [
    'await require("tools").docs.del({}); return 1',
    'cannot_analyze',
  ],
  requireNodePrefix: [
    'const t = require("node:tools"); await t.docs.del({})',
    'cannot_analyze',
  ],
  requireConcat: [
    'const t = require("to" + "ols"); await t.docs.del({})',
    'cannot_analyze',
  ],
  requireTemplate: [
    'const t = require(`tools`); await t.docs.del({})',
    'cannot_analyze',
  ],
  requireComputed: [
    'const name = "tools"; return Object.keys(require(name))',
    'cannot_analyze',
  ],
  requireFs: ['return typeof require("fs")', 'cannot_analyze'],
  requireSearch: ['return Object.keys(require("search"))', 'cannot_analyze'],
  requireShadowed: [
    'const require = (x) => x; return require("tools")',
    'cannot_analyze',
  ],

  // import, in every form.
  importDynamic: [
    'const t = await import("tools"); await t.default.docs.del({})',
    'cannot_analyze',
  ],
  importDynamicInFunction: [
    'async function f() { return import("tools") } await (await f()).docs.del({})',
    'cannot_analyze',
  ],
  importDefault: [
    'import t from "tools"; await t.docs.del({})',
    'cannot_analyze',
  ],
  importNamespace: [
    'import * as m from "tools"; await m.docs.del({})',
    'cannot_analyze',
  ],
  importNamed: [
    'import { docs } from "tools"; await docs.del({})',
    'cannot_analyze',
  ],
  importNamedAlias: [
    'import { docs as tools } from "tools"; await tools.del({})',
    'cannot_analyze',
  ],
  importBare: ['import "tools"; return 1', 'cannot_analyze'],
  importMeta: ['return typeof import.meta', 'cannot_analyze'],
  exportDeclaration: ['export const x = 1', 'diagnostics'],

  // tools anywhere but a direct call of a catalog operation.
  destructure: [
    'const { tasks } = tools; await tasks.create({})',
    'cannot_analyze',
  ],
  destructureNested: [
    'const { docs: { del } } = tools; await del({})',
    'cannot_analyze',
  ],
  aliasRoot: ['const t = tools; await t.docs.del({})', 'cannot_analyze'],
  aliasNamespace: ['const s = tools.docs; await s.del({})', 'cannot_analyze'],
  detached: ['const f = tools.docs.del; await f({})', 'cannot_analyze'],
  commaCallee: ['await (0, tools.docs.del)({}); return 1', 'cannot_analyze'],
  conditionalRoot: [
    'await (true ? tools : null).docs.del({}); return 1',
    'cannot_analyze',
  ],
  orRoot: [
    'const t = 0 || tools; await t.docs.del({}); return 1',
    'cannot_analyze',
  ],
  newTool: ['new tools.docs.del({})', 'cannot_analyze'],
  tagged: ['await tools.docs.del`x`; return 1', 'cannot_analyze'],
  templateKey: ['await tools[`docs`].del({}); return 1', 'cannot_analyze'],
  computedKey: [
    'const k = "del"; await tools.docs[k]({}); return 1',
    'cannot_analyze',
  ],
  numberKey: ['await tools.docs[0]({}); return 1', 'cannot_analyze'],
  dottedKey: ['await tools["docs.del"]({}); return 1', 'cannot_analyze'],
  dottedSecondKey: [
    'await tools.docs["del.x"]({}); return 1',
    'cannot_analyze',
  ],
  oneSegment: ['await tools.docs({}); return 1', 'cannot_analyze'],
  threeSegments: ['await tools.docs.del.x({}); return 1', 'cannot_analyze'],
  unknownOperation: ['await tools.docs.nope({}); return 1', 'cannot_analyze'],
  prototypeKey: ['return await tools.docs.constructor({})', 'cannot_analyze'],
  protoRoot: ['return await tools.__proto__', 'cannot_analyze'],
  callMethod: [
    'await tools.docs.del.call(null, {}); return 1',
    'cannot_analyze',
  ],
  applyMethod: [
    'await tools.docs.del.apply(null, [{}]); return 1',
    'cannot_analyze',
  ],
  bindMethod: [
    'await tools.docs.del.bind(null)({}); return 1',
    'cannot_analyze',
  ],
  callbackMap: [
    'return await Promise.all([{}].map(tools.docs.del))',
    'cannot_analyze',
  ],
  callbackThen: [
    'return await Promise.resolve({}).then(tools.docs.del)',
    'cannot_analyze',
  ],
  shorthandObject: [
    'const o = { tools }; return await o.tools.docs.del({})',
    'cannot_analyze',
  ],
  spreadRoot: [
    'const o = { ...tools }; return await o.docs.del({})',
    'cannot_analyze',
  ],
  arrayOfTools: [
    'for (const t of [tools]) await t.docs.del({}); return 1',
    'cannot_analyze',
  ],
  objectKeys: ['return Object.keys(tools)', 'cannot_analyze'],
  objectValues: ['return Object.values(tools.docs)', 'cannot_analyze'],
  forIn: ['for (const k in tools) {} return 1', 'cannot_analyze'],
  inOperator: ['return "docs" in tools', 'cannot_analyze'],
  typeofTools: ['return typeof tools', 'cannot_analyze'],
  typeofOperation: ['return typeof tools.docs.del', 'cannot_analyze'],
  deleteOperation: ['delete tools.docs.del; return 1', 'cannot_analyze'],
  assignTools: ['tools = 1; return 1', 'cannot_analyze'],
  assignOperation: ['tools.docs.del = () => 1; return 1', 'cannot_analyze'],
  awaitTools: [
    'const t = await tools; return Object.keys(t)',
    'cannot_analyze',
  ],
  returnTools: ['return tools', 'cannot_analyze'],
  throwTools: [
    'try { throw tools } catch (e) { await e.docs.del({}) }',
    'cannot_analyze',
  ],
  structuredCloneTools: ['return structuredClone(tools)', 'cannot_analyze'],
  jsonOfTools: ['return JSON.stringify(tools)', 'cannot_analyze'],
  jsonReviverTools: ['return JSON.parse("{}", () => tools)', 'cannot_analyze'],
  withTools: ['with (tools) { await docs.del({}) }', 'cannot_analyze'],
  parameterDefaultTools: [
    'function f(t = tools) { return t.docs.del({}) } await f()',
    'cannot_analyze',
  ],

  // Bindings and shadowing (upstream's scan misses the parameter default).
  parameterDefaultBodyVar: [
    'function f(a = tools.docs.del({})) { var tools = 1; return a } return await f()',
    'cannot_analyze',
  ],
  awaitInParameterDefault: [
    'async function f(a = await tools.docs.del({})) { var tools = 1; return a } return await f()',
    'diagnostics',
  ],
  topVar: [
    'var tools = { docs: { del: () => 1 } }; return tools.docs.del({})',
    'cannot_analyze',
  ],
  letLater: [
    'const r = tools.docs.del({}); let tools = 1; return 1',
    'cannot_analyze',
  ],
  varHoistedLater: [
    'await tools.docs.del({}); if (false) { var tools = 1 }',
    'cannot_analyze',
  ],
  innerVar: [
    'const x = await tools.docs.del({}); function g() { var tools } return 1',
    'cannot_analyze',
  ],
  blockLet: [
    '{ { let tools = 1 } await tools.docs.del({}) } return 1',
    'cannot_analyze',
  ],
  forLet: [
    'for (let tools = 0; tools < 1; tools++) {} await tools.docs.del({}); return 1',
    'cannot_analyze',
  ],
  switchLet: [
    'switch (1) { case 1: let tools = 1 } return await tools.docs.del({})',
    'cannot_analyze',
  ],
  parameter: [
    'const f = (tools) => tools.docs.del({}); return 1',
    'cannot_analyze',
  ],
  parameterGivenRequire: [
    'const f = (tools) => tools.docs.del({}); return await f(require("tools"))',
    'cannot_analyze',
  ],
  catchParameter: [
    'try { throw 1 } catch (tools) {} await tools.docs.del({}); return 1',
    'cannot_analyze',
  ],
  functionName: ['function tools() {} return 1', 'cannot_analyze'],
  functionExpressionName: [
    'const g = function tools() { return tools.docs }; return typeof g()',
    'cannot_analyze',
  ],
  blockFunction: [
    '{ function tools() {} } await tools.docs.del({}); return 1',
    'cannot_analyze',
  ],
  className: ['class tools {} return 1', 'cannot_analyze'],
  label: ['tools: for (;;) { break tools } return 1', 'cannot_analyze'],
  labelThenCall: [
    'tools: for (;;) { break tools } await tools.docs.del({})',
    'cannot_analyze',
  ],
  patternValue: [
    'const { a: tools } = { a: 1 }; return tools',
    'cannot_analyze',
  ],
  arrayPattern: ['const [tools] = [1]; return tools', 'cannot_analyze'],
  restPattern: ['const { ...tools } = {}; return tools', 'cannot_analyze'],
  assignmentPattern: [
    'let x; ({ x: tools } = { x: 1 }); return 1',
    'cannot_analyze',
  ],

  // Dynamic code, the global object and reflection: none of it exists, and
  // naming tools inside it is refused all the same.
  functionConstructor: [
    'const F = (() => 1).constructor; return F("return tools")()',
    [],
  ],
  asyncFunctionConstructor: [
    'const F = (async () => 1).constructor; return await F("return tools.docs.del({})")()',
    [],
  ],
  functionGlobal: ['return Function("return 1")()', []],
  newFunction: ['return new Function("return 1")()', []],
  constructorChain: ['return [].map.constructor("return this")()', []],
  evalCall: ['return eval("tools.docs.del({})")', []],
  indirectEval: ['return (0, eval)("1")', []],
  globalThisMember: ['return await globalThis.tools.docs.del({})', []],
  globalThisComputed: [
    'return await globalThis["to" + "ols"].docs.del({})',
    [],
  ],
  topLevelThis: ['return await this.tools.docs.del({})', []],
  functionThis: [
    'function f() { return this } return await f().tools.docs.del({})',
    [],
  ],
  methodThisShorthand: [
    'const o = { tools, m() { return this.tools.docs.del({}) } }; return 1',
    'cannot_analyze',
  ],
  arguments: ['function f() { return arguments } return Object.keys(f(1))', []],
  argumentsCallee: [
    'function f() { return arguments.callee } return typeof f()',
    [],
  ],
  reflectGet: ['return Reflect.get({}, "tools")', []],
  proxy: ['return new Proxy({}, {})', []],
  definePropertyGetter: [
    'const o = {}; Object.defineProperty(o, "x", { get() { return 1 } }); return o.x',
    [],
  ],
  setTimeoutString: ['setTimeout("1", 0); return 1', []],
  jsonReviverThis: [
    'return JSON.parse(\'{"a":1}\', function (k, v) { return this })',
    [],
  ],
  symbolRegistry: ['return Symbol.for("tools")', []],
  processGlobal: ['return process.env', []],
  denoGlobal: ['return Deno.env', []],
  fetchGlobal: ['return await fetch("https://example.com")', []],
  webAssembly: ['return typeof WebAssembly', []],
  contextBinding: ['return context', []],
  // `get` and `call` reach the run's module, never the SDK: plain globals.
  moduleGet: ['return await get("total")', []],
  moduleCallWithToolData: [
    'const t = await tools.tasks.read({}); return await call("render", t)',
    ['tasks.read'],
  ],
  moduleShadowed: [
    'const get = () => tools.docs.del({}); return await get()',
    ['docs.del'],
  ],
  moduleCallPassesTools: ['return await call("f", tools)', 'cannot_analyze'],
  moduleCallPassesService: [
    'return await call("f", tools.tasks)',
    'cannot_analyze',
  ],
  moduleCallPassesOperation: [
    'return await call("f", tools.tasks.read)',
    'cannot_analyze',
  ],
  moduleCallPassesCallback: [
    'return await call("f", () => tools.docs.del({}))',
    ['docs.del'],
  ],
};

describe('JS tools analysis', () => {
  // Everything the interpreter calls when it runs each program: the tool
  // adapter records every call, and every catalog tool is admitted, so only
  // the analysis stands between a program and an unreported call.
  const called: string[] = [];
  // What reached the module: only copied data, never a function.
  const crossed: unknown[] = [];
  const runtime = makeRuntime({
    catalog: CATALOG,
    admitted: new Set(TOOLS.keys()),
    call: async (target) => {
      called.push(target.path.join('.'));
      return { ok: true };
    },
    module: {
      get: async (name) => {
        crossed.push(name);
        return 1;
      },
      call: async (name, args) => {
        crossed.push(name, ...args);
        return 1;
      },
    },
    limits: { timeoutMs: 5000, maxToolCalls: 64, maxOutputBytes: 64 * 1024 },
  });

  for (const [name, [source, expected]] of Object.entries(CORPUS)) {
    it(`${name}: what it may call covers what it calls`, async () => {
      const analysis = analyze(source, TOOLS);
      if (Array.isArray(expected)) {
        expect(analysis).toMatchObject({ status: 'ok' });
        expect(
          analysis.status === 'ok' && analysis.operations.map((op) => op.path)
        ).toEqual(expected);
      } else {
        expect(analysis.status).toBe(expected);
      }

      called.length = 0;
      crossed.length = 0;
      await runtime.execute(source, { context: { sessionId: 'session' } });
      if (analysis.status === 'ok') {
        const allowed = analysis.operations.map((op) => op.path);
        expect(called.filter((path) => !allowed.includes(path))).toEqual([]);
      }
      expect(crossed.filter((value) => typeof value === 'function')).toEqual(
        []
      );
    });
  }

  // Why upstream's `scanTools` isn't enough: it admits these programs
  // without the operation the interpreter then calls.
  for (const name of [
    'requireAlias',
    'requireCall',
    'requireApply',
    'requireInArray',
    'requireBind',
    'parameterDefaultBodyVar',
  ]) {
    it(`${name}: upstream's scan misses a call the interpreter makes`, async () => {
      const [source] = CORPUS[name] ?? [''];
      const upstream = CodeMode.scanTools(source);
      expect(Result.isSuccess(upstream) && upstream.success).toEqual([]);
      called.length = 0;
      await runtime.execute(source, {});
      expect(called).toEqual(['docs.del']);
    });
  }

  it('reports the operation with its route, method and rivals', () => {
    const catalog: Catalog = {
      tools: [
        {
          ...tool('storage', 'get_document_markdown'),
          httpMethod: 'GET',
          route: '/documents/{}/markdown',
          rivals: [{ service: 'storage', route: '/documents/slug/{}' }],
        },
      ],
      defs: {},
      skipped: [],
    };
    expect(
      analyze(
        'return await tools.storage.get_document_markdown({ path: { document_id: "d" } })',
        toolsByPath(catalog)
      )
    ).toEqual({
      status: 'ok',
      operations: [
        {
          path: 'storage.get_document_markdown',
          service: 'storage',
          operation: 'get_document_markdown',
          method: 'GET',
          route: '/documents/{}/markdown',
          rivals: [{ service: 'storage', route: '/documents/slug/{}' }],
        },
      ],
    });
  });

  it('locates each refusal and suggests the closest operation', () => {
    expect(
      analyze('const r = require\nawait tools.docs.dle({})', TOOLS)
    ).toEqual({
      status: 'cannot_analyze',
      reasons: [
        {
          message:
            "Programs can't load modules; call tools.<service>.<operation>(...) directly.",
          location: { line: 1, column: 10 },
        },
        {
          message:
            'tools.docs.dle is not an operation; did you mean tools.docs.del? Find operations with search("...").',
          location: { line: 2, column: 6 },
        },
      ],
    });
  });

  it('refuses a program nested too deeply to parse', () => {
    expect(
      analyze(`return ${'['.repeat(100_000)}${']'.repeat(100_000)}`, TOOLS)
    ).toMatchObject({
      status: 'cannot_analyze',
      reasons: [{ message: 'The program is nested too deeply to analyze.' }],
    });
  });

  it('suggests operations for only the first few unknown ones', () => {
    const source = Array.from(
      { length: 6 },
      (_, index) => `await tools.docs.nope${index}({})`
    ).join('\n');
    const analysis = analyze(source, TOOLS);
    expect(
      analysis.status === 'cannot_analyze' &&
        analysis.reasons.map((reason) =>
          reason.message.includes('did you mean')
        )
    ).toEqual([true, true, true, false, false, false]);
  });

  it('gives a parse failure as located diagnostics', () => {
    expect(analyze('const x = ;', TOOLS)).toEqual({
      status: 'diagnostics',
      diagnostics: [
        {
          message:
            'SyntaxError: Unexpected token. Code must be plain JavaScript written as a program body. (line 1, col 11)',
          location: { line: 1, column: 10 },
        },
      ],
    });
    expect(analyze('', TOOLS)).toMatchObject({ status: 'diagnostics' });
  });

  // Our parser accepts exactly what the interpreter's does, over the corpus
  // and a sample of the syntax the interpreter documents.
  const SYNTAX = [
    ...Object.values(CORPUS).map(([source]) => source),
    'const [a, , ...b] = [1, 2, 3]; const { c = 1, ...d } = {}; return [a, b, c, d]',
    'let x = 1n + 2n; x **= 2n; return String(x)',
    'const o = { a: 1, ["b" + 1]: 2, m() { return 1 }, async n() {}, *g() {} }; return o?.a ?? 0',
    'label: for (const x of [1]) { continue label } return 1',
    'const re = /a(?<n>b)/gu; return "ab".match(re)',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal in a program
    'return `a${1}b`',
    'try { throw new Error("x") } catch { } finally { } return 1_000',
    'async function* g() { yield* [1] } const out = []; for await (const x of g()) out.push(x); return out',
    'class A { #x = 1; static y = 2; get z() { return this.#x } } return 1',
    'const f = async ({ a } = {}, ...rest) => a; return await f()',
    'do { } while (false); switch (1) { default: } return void 0',
    'x = 1',
    'return import.meta',
    'return )',
    'return 1 +',
    '#!/usr/bin/env node\nreturn 1',
    'return <div/>',
    'let x: number = 1; return x',
    'await 1; return arguments',
  ];
  it('parses exactly what the interpreter parses', () => {
    for (const source of SYNTAX) {
      const upstream = CodeMode.scanTools(source);
      const upstreamParses = !(
        Result.isFailure(upstream) && upstream.failure.kind === 'ParseError'
      );
      expect(
        [source, analyze(source, TOOLS).status !== 'diagnostics'],
        source
      ).toEqual([source, upstreamParses]);
      expect(JSON.stringify(analyze(source, TOOLS)), source).not.toContain(
        'parser mismatch'
      );
    }
  });
});
