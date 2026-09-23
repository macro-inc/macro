// Run in a separate V8 process with --expose-gc. Minify the real hook modules,
// stub their imports, retain resolved options, and drop the simulated callers.
// This tests closure reachability, not cache eviction or browser memory totals.
// The deliberately leaking control proves the probe can observe retention.
import fs from 'node:fs/promises';
import ts from 'typescript';
import { build } from 'esbuild';
const base = new URL('../', import.meta.url);
const cases = [
  ['leaking-control.ts', 'useLeakingQuery', 'id'],
  ['soup/search.ts', 'useSearchChannelQuery', 'search'],
  ['agent-session/session.ts', 'useAgentSessionQuery', 'id'],
  ['agent-session/mentions.ts', 'useAgentSessionMentionPreview', 'id-enabled'],
  ['channel/picture.ts', 'useChannelPicture', 'id'],
  ['auth/cursor-api-key.ts', 'useCursorApiKeyStatusQuery', 'enabled'],
  ['auth/cursor-api-key.ts', 'useCursorModelsQuery', 'enabled'],
  ['cognition/chat-data.ts', 'useChatDataQuery', 'id'],
  ['storage/document-metadata.ts', 'useDocumentMetadataQuery', 'id'],
  ['storage/document-metadata.ts', 'useDocumentAccessLevelQuery', 'id'],
  ['sync/document-peers.ts', 'useDocumentPeersQuery', 'id'],
  ['call/call.ts', 'useActiveCallQuery', 'id'],
  ['call/call.ts', 'useCallRecordQuery', 'id'],
  ['storage/task-duplicates.ts', 'useTaskDuplicatesQuery', 'id'],
  ['storage/task-duplicates.ts', 'useTaskSimilaritySearchQuery', 'input'],
  ['storage/team-share.ts', 'useDocumentTeamShareQuery', 'id'],
  ['preview/preview.ts', 'useItemPreview', 'item'],
  ['soup/search.ts', 'useSearchSoupQuery', 'search'],
  ['soup/items.ts', 'useSoupItemsQuery', 'soup'],
  ['channel/channel-participants.ts', 'useChannelParticipantsQuery', 'id'],
  ['messages/thread-replies.ts', 'useThreadRepliesQuery', 'thread'],
];
globalThis.__auditOptions = [];
const helper = `
function proxy(path='stub', args=[]) { return new Proxy(function(){},{ get(_,key) {
  if(key==='queryKey') return [path,...args];
  if(key==='then') return undefined;
  if(key==='enabled') return false;
  return proxy(path+'.'+String(key),args);
}, apply(_,__,next) { return proxy(path,next); } }); }
function query(factory) { const options=factory();globalThis.__auditOptions.push(options);return {isSuccess:false,isPending:true,data:undefined}; }
`;
function stub(name) {
  if (['queryOptions', 'infiniteQueryOptions'].includes(name)) return '(x=>x)';
  if (name === 'useChannelsContext') return '(()=>({channels:()=>[]}))';
  if (name === 'createSearchResponseItemMapper') return '(()=>value=>value)';
  if (['useQuery', 'useInfiniteQuery', 'createInfiniteQuery'].includes(name))
    return 'query';
  if (name === 'queryClient') return '({getQueryState:()=>({})})';
  if (name === 'useFeatureFlag') return '(()=>()=>({enabled:false}))';
  if (name === 'createMemo') return '(fn=>fn)';
  if (name === 'queryReadyGate') return '(()=>false)';
  if (name === 'isGraphqlPreviewItem' || name === 'isFeatureEnabled')
    return '(()=>false)';
  if (name === 'createGraphqlItemPreviewQuery')
    return '(()=>({shouldFallback:()=>false,data:()=>undefined}))';
  if (name === 'useMessageSubscription') return '(()=>{})';
  if (name === 'useInstructionsMdIdQuery') return '(()=>({data:undefined}))';
  if (name === 'useSearchResponseItemMapper') return '(()=>value=>value)';
  if (name === 'createSignal') return '(value=>[()=>value,next=>{value=next}])';
  if (name === 'createStore') return '(value=>[value,()=>{}])';
  return `proxy(${JSON.stringify(name)})`;
}
const reports = [];
for (const [file, fnName, kind] of cases) {
  globalThis.__auditOptions = [];
  try {
    const source =
      file === 'leaking-control.ts'
        ? `import {useQuery} from '@tanstack/solid-query'; export function useLeakingQuery(id) { return useQuery(() => ({ queryFn: () => id() })); }`
        : await fs.readFile(new URL(file, base), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const mocks = {};
    for (const statement of ast.statements)
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (!clause || clause.isTypeOnly) continue;
        const names = [];
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
          for (const el of clause.namedBindings.elements)
            if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
        mocks[statement.moduleSpecifier.text] =
          helper +
          names.map((name) => `export const ${name}=${stub(name)};`).join('\n');
      }
    const result = await build({
      stdin: { contents: source, loader: 'ts', sourcefile: file },
      write: false,
      bundle: true,
      format: 'esm',
      minify: true,
      plugins: [
        {
          name: 'stub-imports',
          setup(b) {
            b.onResolve({ filter: /.*/ }, ({ path }) => ({
              path,
              namespace: 'stub',
            }));
            b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => {
              if (!(path in mocks)) throw Error('Unexpected import ' + path);
              return { contents: mocks[path], loader: 'js' };
            });
          },
        },
      ],
    });
    const mod = await import(
      'data:text/javascript;base64,' +
        Buffer.from(result.outputFiles[0].text + '\n//' + fnName).toString(
          'base64'
        )
    );
    const refs = [];
    function mount(i) {
      const row = {
        id: 'row-' + i,
        enabled: true,
        parent: { type: 'channel', id: 'channel' },
        input: { title: 'title-' + i, markdown: 'test' },
        search: { params: { page_size: 20 }, body: { query: 'test-' + i } },
      };
      refs.push(new WeakRef(row));
      const fn = mod[fnName];
      if (kind === 'id') fn(() => row.id);
      else if (kind === 'id-enabled')
        fn(
          () => row.id,
          () => row.enabled
        );
      else if (kind === 'enabled') fn(() => row.enabled);
      else if (kind === 'input') fn(() => row.input);
      else if (kind === 'item') fn(() => ({ id: row.id, type: 'document' }));
      else if (kind === 'search' || kind === 'soup')
        fn(
          () => row.search,
          () => ({ enabled: row.enabled })
        );
      else
        fn(
          () => row.parent,
          () => row.id,
          () => row.enabled
        );
    }
    for (let i = 0; i < 25; i++) mount(i);
    await new Promise((r) => setImmediate(r));
    for (let i = 0; i < 3; i++) {
      global.gc();
      await new Promise((r) => setImmediate(r));
    }
    const retained = refs.filter((r) => r.deref()).length;
    const report = {
      file,
      hook: fnName,
      rows: 25,
      cachedOptions: __auditOptions.length,
      retained,
    };
    reports.push(report);
    console.log(JSON.stringify(report));
  } catch (e) {
    const report = { file, hook: fnName, error: e.message };
    reports.push(report);
    console.log(JSON.stringify(report));
  }
}
globalThis.__auditOptions = [];
