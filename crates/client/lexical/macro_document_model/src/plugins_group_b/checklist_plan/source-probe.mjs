// Reproduce pinned plain-data Source outputs without an editor or transformed source.
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const source = process.env.SOURCE_CHECKLIST_ROOT;
const destination = process.argv[2];
if (!source || !destination) throw new Error('SOURCE_CHECKLIST_ROOT and output path are required');
await rm(destination, { force: true });
const model = join(source, 'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/model.ts');
const constants = join(source, 'apps/web/src/features/property/constants.ts');
const identifiers = join(source, 'apps/web/src/features/property/identifiers.ts');
const hash = data => createHash('sha256').update(data).digest('hex');
const modelSha = '201bb633173f84fe6436c132043f17e78b49fceb8b146e1a0c4f0bbc8ff8b3d3';
if (hash(await readFile(model)) !== modelSha) throw new Error('Source model pin mismatch');
if (hash(await readFile(constants)) !== 'a3932b2d552a872b4acad10c28c318998b24c78f333fb4b9e61e9e7051de3385') throw new Error('Source constants pin mismatch');
if (hash(await readFile(identifiers)) !== 'd89e276f5a9698ce7373529920b98dd00a51cd630cde07a8de6e685a5c44f659') throw new Error('Source identifiers pin mismatch');
const configSha = hash(await readFile(join(source, 'apps/web/tsconfig.json')));
if (configSha !== '23a25b9e157ba5f0ee0a1e1da117cf28e5590b7163bcd56a54f8196a6b092b9a') throw new Error('Source tsconfig pin mismatch');
const actual = await import(model);
const inputBytes = await readFile(join(import.meta.dir, 'source-inputs.json'));
const cases = JSON.parse(inputBytes);
const dateFnsRoot = dirname(Bun.resolveSync('date-fns', model));
const dateFnsFiles = {};
for (const path of ['differenceInCalendarDays.js', '_lib/getTimezoneOffsetInMilliseconds.js', 'startOfDay.js', 'toDate.js', '_lib/normalizeDates.js', 'constructFrom.js']) {
  dateFnsFiles[path] = hash(await readFile(join(dateFnsRoot, path)));
}
const { getTimezoneOffsetInMilliseconds } = await import(join(dateFnsRoot, '_lib/getTimezoneOffsetInMilliseconds.js'));
const numberFact = value => Number.isNaN(value) ? { nan: true } : { number: value };
const dateFnsVersion = JSON.parse(await readFile(join(dateFnsRoot, 'package.json'), 'utf8')).version;
const fields = date => ({
  date: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() },
  hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(), millisecond: date.getMilliseconds(),
});
const observe = date => {
  const midnight = new Date(date.getTime());
  midnight.setHours(0, 0, 0, 0);
  return {
    instantMs: date.getTime(), local: fields(date),
    startOfDay: Number.isNaN(midnight.getTime()) ? { invalid: true } : { valid: { instantMs: midnight.getTime(), local: fields(midnight) } },
  };
};

const callerPath = join(source, 'apps/web/src/lib/core/component/LexicalMarkdown/component/task-list/TaskListControls.tsx');
const caller = await readFile(callerPath, 'utf8');
const callerSha = hash(Buffer.from(caller));
if (callerSha !== '27e13b7447d64172dc41b3361f9fec7ca06c2eb2670341fdff1f2bc6dc079ea3') throw new Error('Source caller pin mismatch');
const ts = (await import(Bun.resolveSync('typescript', model))).default;
const ast = ts.createSourceFile(callerPath, caller, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const found = { hasTasks: [], progressPct: [], items: [], resolveName: [] };
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && Object.hasOwn(found, node.name.text)) {
    found[node.name.text].push(node.initializer);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
for (const values of Object.values(found)) if (values.length !== 1) throw new Error('Source caller shape mismatch');
function memoBody(name) {
  const memo = found[name][0];
  if (!ts.isCallExpression(memo) || memo.expression.getText(ast) !== 'createMemo' || memo.arguments.length !== 1 || !ts.isArrowFunction(memo.arguments[0]) || ts.isBlock(memo.arguments[0].body) || memo.arguments[0].parameters.length !== 0) throw new Error(`Source ${name} shape mismatch`);
  return memo.arguments[0].body.getText(ast);
}
const bodies = { hasTasks: memoBody('hasTasks'), items: memoBody('items') };
const progress = found.progressPct[0];
if (!ts.isArrowFunction(progress) || !ts.isBlock(progress.body) || progress.parameters.length !== 0) throw new Error('Source progress shape mismatch');
bodies.progressPct = progress.body.getText(ast).slice(1, -1);
const resolver = found.resolveName[0];
if (!ts.isArrowFunction(resolver) || ts.isBlock(resolver.body) || resolver.parameters.length !== 1 || resolver.parameters[0].name.getText(ast) !== 'id') throw new Error('Source name resolver shape mismatch');
bodies.resolveName = resolver.body.getText(ast);
// Execute only unchanged, pinned pure caller bodies with plain-data accessors.
// This does not construct the component, fake an editor, or establish rendered UI parity.
const sourceHasTasks = new Function('meta', `return (${bodies.hasTasks});`);
const sourceItems = new Function('meta', 'props', 'effectiveItem', `return (${bodies.items});`);
const sourceResolveName = new Function('id', 'nameById', `return (${bodies.resolveName});`);
const sourceProgress = new Function('props', bodies.progressPct);
const rows = [];
for (const input of cases) {
  try {
    const settings = actual.normalizeSettings(input.meta?.settings);
    const nameMap = new Map(Object.entries(input.names));
    const items = sourceItems(() => input.meta, {
      taskInfo: input.tasks,
      resolveName: id => sourceResolveName(id, () => nameMap),
    }, actual.effectiveItem);
    const now = new Date(input.now);
    const dueDates = Object.create(null);
    const dueOffsets = Object.create(null);
    for (const item of items) if (item.due) {
      const parsed = new Date(item.due);
      dueOffsets[item.due] = numberFact(getTimezoneOffsetInMilliseconds(parsed));
      dueDates[item.due] = Number.isNaN(parsed.getTime()) ? { invalid: true } : { valid: observe(parsed) };
    }
    const count = actual.countActiveFilters(settings.filters);
    const plan = actual.planChecklist(items, settings, now);
    rows.push({
      input, calendar: { today: observe(now), dueDates },
      calendarDiagnostics: { originalOffset: numberFact(getTimezoneOffsetInMilliseconds(now)), dueOffsets },
      source: {
        settings, items, plan, hasTasks: sourceHasTasks(() => input.meta),
        progressPct: sourceProgress({ plan: () => plan }), filterCount: numberFact(count),
      },
    });
  } catch (error) {
    rows.push({ input, source: { error: { name: error.name } } });
  }
}
const output = {
  sourceCommit: '34959817b73c6d30e1b768320120f77865dcd352', modelSha256: modelSha,
  callerSha256: callerSha, configSha256: configSha,
  callerBodyHashes: Object.fromEntries(Object.entries(bodies).map(([name, body]) => [name, hash(Buffer.from(body))])),
  runtime: `Bun ${Bun.version}`, parserVersion: ts.version, dateFnsVersion, dateFnsFiles,
  inputSha256: hash(inputBytes), objectPrototypeKeys: Object.getOwnPropertyNames(Object.prototype).sort(),
  timezone: process.env.TZ, rows,
};
// Keep non-data Source outcomes explicit; never serialize NaN as JSON null.
await writeFile(destination, JSON.stringify(output, (_key, value) => {
  if (value === undefined) return { undefined: true };
  if (typeof value === 'function') return { function: value.name };
  if (value === Object.prototype) return { objectPrototype: true };
  return value;
}, 2) + '\n');
