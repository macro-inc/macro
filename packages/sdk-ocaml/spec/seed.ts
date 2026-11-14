/**
 * Writes the first permissions.json from what the hand-written TypeScript SDK
 * already knows. Run once; after that permissions.json is edited by hand and
 * this script refuses to overwrite it unless given --force.
 *
 *   bun seed.ts [--force]
 *
 * How an operation is classified:
 *
 * 1. Wrapped operations. Every SDK method tagged @readonly, @write, @send or
 *    @destructive is followed through the calls it makes (helpers, handle
 *    methods, constructors) to the generated client calls it reaches
 *    (`.storage.editDocument(`, resolved by the type checker). A tagged method reached on the way is not
 *    followed: it classifies its own calls.
 *    - action: @readonly read, @send send, @destructive destroy, @write create
 *      for POST, update for PUT/PATCH, destroy for DELETE. A GET or HEAD is
 *      always read, and so is a POST in POST_READS. Several tagged methods
 *      reaching one operation with different actions take the most
 *      restrictive (destroy > send > update > create > read); those are
 *      printed as conflicts.
 *    - group: the entity directory (src/entities/<group>/) holding most of the
 *      operation's direct call sites, else that of the tagged methods.
 * 2. Operations no tagged method reaches. Action from the HTTP method
 *    (GET/HEAD read, POST create, PUT/PATCH update, DELETE destroy;
 *    POST_READS read). Group from the entity directory of their call sites
 *    when untagged SDK code calls them, else from the wrapped operation of
 *    the same service sharing the longest literal path prefix, else
 *    FALLBACK_GROUPS.
 *
 * The seed prints counts and conflicts; hand corrections then go straight
 * into permissions.json.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { ACTIONS, type Action, type Permissions } from './build';
import { readSpecOperations, type SpecOperation } from './specs';

const sdkRoot = fileURLToPath(new URL('../../sdk/', import.meta.url));
const permissionsPath = fileURLToPath(
  new URL('./permissions.json', import.meta.url)
);

// POST operations that only read, copied from postReads in
// packages/code-mode-sdk/scripts/generate.ts.
const POST_READS = new Set([
  'agent-harness.previewAgentSessions',
  'auth.getGithubPullRequestMergeability',
  'auth.getTeamByInviteLink',
  'auth.getUserNames',
  'auth.getUserNamesWithEmail',
  'cognition.decisions',
  'cognition.getBatchPreview',
  'cognition.getChatHistoryBatchMessagesHandler',
  'cognition.getUsageHandler',
  'email.getMessagesBatch',
  'notification.bulkGetTypedNotificationsByEventItemIds',
  'properties.getBulkEntityProperties',
  'scheduled-action.checkScheduledAction',
  'search.simpleUnifiedSearch',
  'search.unifiedSearch',
  'storage.getBatchCallRecordPreview',
  'storage.getBatchChannelPreview',
  'storage.getBatchPreviewHandler',
  'storage.getBatchProjectPreview',
  'storage.getGithubPullRequestTasks',
  'storage.mentionPreviews',
  'storage.postItemsSoup',
  'storage.postItemsSoupAst',
  'storage.postItemsSoupAstGrouped',
  'storage.previewSmartTag',
  'storage.queryCrmPipelineRows',
  'storage.taskSimilaritySearchHandler',
  'unfurl.getUnfurlBulk',
]);

// Group for an unwrapped operation with no wrapped neighbour, by service and
// then the path's first segment ('*' for the rest of the service).
const FALLBACK_GROUPS: Record<string, Record<string, string>> = {
  'agent-harness': { '*': 'agent-sessions' },
  auth: {
    '*': 'me',
    team: 'teams',
    teams: 'teams',
    github: 'github-pull-requests',
  },
  calendar: { '*': 'calendar' },
  cognition: {
    '*': 'chats',
    memory: 'memory',
    import: 'imports',
    skills: 'ai',
  },
  connection: { '*': 'connected-apps' },
  contacts: { '*': 'users' },
  email: { '*': 'email' },
  notification: { '*': 'notifications' },
  properties: { '*': 'properties' },
  'scheduled-action': { '*': 'routines' },
  search: { '*': 'search' },
  'static-files': { '*': 'images' },
  storage: { '*': 'documents' },
  unfurl: { '*': 'unfurls' },
};

const RESTRICTIVENESS: Action[] = [
  'read',
  'create',
  'update',
  'send',
  'destroy',
];

const TAGS = ['readonly', 'write', 'send', 'destructive'] as const;

type Tag = (typeof TAGS)[number];

type FunctionLike = ts.FunctionLikeDeclaration & { body: ts.Node };

/** Generated method name per service -> spec operation, matched by method and URL. */
function generatedNames(
  operations: SpecOperation[]
): Map<string, SpecOperation> {
  const byRoute = new Map(
    operations.map((op) => [`${op.service} ${op.method} ${op.path}`, op])
  );
  const byGenerated = new Map<string, SpecOperation>();
  const services = new Set(operations.map((op) => op.service));

  for (const service of services) {
    const source = readFileSync(
      `${sdkRoot}generated/${service}/sdk.gen.ts`,
      'utf8'
    );
    const methods = source.matchAll(
      /public (\w+)<[\s\S]*?\.(get|post|put|patch|delete|head|options)<[\s\S]*?url: '([^']+)'/g
    );

    for (const [, name, method, url] of methods) {
      const operation = byRoute.get(
        `${service} ${method?.toUpperCase()} ${url}`
      );
      if (!operation)
        throw new Error(
          `${service}.${name}: no spec operation for ${method} ${url}`
        );
      byGenerated.set(`${service}.${name}`, operation);
    }
  }

  if (byGenerated.size !== operations.length) {
    throw new Error(
      `matched ${byGenerated.size} generated methods to ${operations.length} operations`
    );
  }

  return byGenerated;
}

function tagOf(node: ts.Node): Tag | undefined {
  const names = ts.getJSDocTags(node).map((tag) => tag.tagName.text);
  const found = TAGS.filter((tag) => names.includes(tag));

  if (found.length > 1)
    throw new Error(`${describe(node)} has several tags: ${found.join(', ')}`);

  return found[0];
}

function describe(node: ts.Node): string {
  const file = node.getSourceFile();
  const { line } = file.getLineAndCharacterOfPosition(node.getStart());
  return `${relative(sdkRoot, file.fileName)}:${line + 1}`;
}

/** `src/entities/<group>/...` -> group. */
function groupOfFile(fileName: string): string | undefined {
  return relative(`${sdkRoot}src/entities`, fileName).match(
    /^([^./][^/]*)\//
  )?.[1];
}

function isSdkSource(fileName: string): boolean {
  const path = relative(sdkRoot, fileName);
  return path.startsWith('src/') && !path.startsWith('src/coverage/');
}

function withBody(node: ts.Node): FunctionLike | undefined {
  const declaration =
    ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)
      ? node.initializer
      : node;

  if (!declaration || !ts.isFunctionLike(declaration)) return undefined;
  if (!('body' in declaration) || !declaration.body) return undefined;

  return declaration as FunctionLike;
}

function readSdkProgram() {
  const configPath = `${sdkRoot}tsconfig.json`;
  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        );
      },
    }
  );

  if (!config) throw new Error(`cannot read ${configPath}`);

  const program = ts.createProgram(config.fileNames, config.options);
  return { program, checker: program.getTypeChecker() };
}

/**
 * The generated client method a call resolves to (`.storage.editDocument(`),
 * as `service.method`: the callee is declared in generated/<service>/sdk.gen.ts.
 */
function generatedCall(
  call: ts.CallExpression,
  checker: ts.TypeChecker
): string | undefined {
  const callee = call.expression;

  if (!ts.isPropertyAccessExpression(callee)) return undefined;

  const declaration = checker.getSymbolAtLocation(callee.name)
    ?.declarations?.[0];
  const file =
    declaration && relative(sdkRoot, declaration.getSourceFile().fileName);
  const service = file?.match(/^generated\/([^/]+)\/sdk\.gen\.ts$/)?.[1];

  return service ? `${service}.${callee.name.text}` : undefined;
}

function seed() {
  const operations = readSpecOperations();
  const byGenerated = generatedNames(operations);
  const { program, checker } = readSdkProgram();

  // Generated calls each function reaches, not following tagged functions.
  const reached = new Map<ts.Node, Set<string>>();

  // Direct call sites per operation name, as entity groups (undefined outside entities/).
  const callSiteGroups = new Map<string, (string | undefined)[]>();

  function declarationsCalled(node: ts.Node): ts.Node[] {
    let target: ts.Node | undefined;

    if (ts.isCallExpression(node) || ts.isNewExpression(node))
      target = node.expression;
    else if (ts.isPropertyAccessExpression(node)) target = node;
    else return [];

    let symbol = checker.getSymbolAtLocation(
      ts.isPropertyAccessExpression(target) ? target.name : target
    );

    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);

    const declarations = symbol?.declarations ?? [];

    // `new Foo()` reaches Foo's constructor; a property access reaches a getter.
    if (ts.isNewExpression(node)) {
      return declarations.flatMap((declaration) =>
        ts.isClassDeclaration(declaration)
          ? declaration.members.filter(ts.isConstructorDeclaration)
          : []
      );
    }

    if (ts.isPropertyAccessExpression(node))
      return declarations.filter(ts.isGetAccessorDeclaration);

    return declarations;
  }

  function reach(fn: ts.Node): Set<string> {
    const known = reached.get(fn);
    if (known) return known;

    const found = new Set<string>();
    reached.set(fn, found);

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const generated = generatedCall(node, checker);

        if (generated) {
          const operation = byGenerated.get(generated);
          if (!operation)
            throw new Error(
              `${describe(node)}: unknown generated method ${generated}`
            );
          found.add(operation.name);
        }
      }

      for (const declaration of declarationsCalled(node)) {
        if (!isSdkSource(declaration.getSourceFile().fileName)) continue;

        const callee = withBody(declaration);
        if (!callee || tagOf(declaration) || tagOf(callee)) continue;

        for (const name of reach(callee)) found.add(name);
      }

      ts.forEachChild(node, visit);
    };

    visit((fn as FunctionLike).body);
    return found;
  }

  // Tagged functions per operation, and every direct generated call site.
  const taggedReach = new Map<
    string,
    { tag: Tag; group: string | undefined; where: string }[]
  >();

  for (const file of program.getSourceFiles()) {
    if (!isSdkSource(file.fileName)) continue;

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const generated = generatedCall(node, checker);
        const operation = generated && byGenerated.get(generated);

        if (operation) {
          const sites = callSiteGroups.get(operation.name) ?? [];
          sites.push(groupOfFile(file.fileName));
          callSiteGroups.set(operation.name, sites);
        }
      }

      const tag = tagOf(node);
      const fn = tag && withBody(node);

      if (tag && fn) {
        for (const name of reach(fn)) {
          const entries = taggedReach.get(name) ?? [];
          entries.push({
            tag,
            group: groupOfFile(file.fileName),
            where: describe(node),
          });
          taggedReach.set(name, entries);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(file);
  }

  const actionFor = (
    operation: SpecOperation,
    tag: Tag | undefined
  ): Action => {
    const { method } = operation;
    const postRead = method === 'POST' && POST_READS.has(camelName(operation));

    if (method === 'GET' || method === 'HEAD' || postRead) return 'read';
    if (tag === 'readonly') return 'read';
    if (tag === 'send') return 'send';
    if (tag === 'destructive' || method === 'DELETE') return 'destroy';
    if (method === 'POST') return 'create';
    return 'update';
  };

  const permissions: Permissions = {};
  const conflicts: string[] = [];
  const wrapped: SpecOperation[] = [];

  for (const operation of operations) {
    const reachers = taggedReach.get(operation.name);
    if (!reachers) continue;

    wrapped.push(operation);

    const actions = reachers.map((reacher) => ({
      ...reacher,
      action: actionFor(operation, reacher.tag),
    }));
    const action = actions
      .map((entry) => entry.action)
      .reduce((a, b) =>
        RESTRICTIVENESS.indexOf(a) >= RESTRICTIVENESS.indexOf(b) ? a : b
      );

    if (new Set(actions.map((entry) => entry.action)).size > 1) {
      const detail = actions
        .map((entry) => `@${entry.tag} ${entry.where}`)
        .join('; ');
      conflicts.push(`${operation.name} -> ${action}: ${detail}`);
    }

    const sites = (callSiteGroups.get(operation.name) ?? []).filter(
      (group) => group !== undefined
    );
    const group =
      mostCommon(sites) ??
      mostCommon(reachers.map((reacher) => reacher.group)) ??
      fallbackGroup(operation);
    permissions[operation.name] = { group, action };
  }

  for (const operation of operations) {
    if (permissions[operation.name]) continue;

    const sites = (callSiteGroups.get(operation.name) ?? []).filter(
      (group) => group !== undefined
    );

    permissions[operation.name] = {
      group:
        mostCommon(sites) ??
        neighbourGroup(operation, wrapped, permissions) ??
        fallbackGroup(operation),
      action: actionFor(operation, undefined),
    };
  }

  // Called from the SDK, but from no tagged method: classified by HTTP method.
  const untagged = operations
    .filter(
      (operation) =>
        callSiteGroups.has(operation.name) && !taggedReach.has(operation.name)
    )
    .map((operation) => operation.name);

  return {
    permissions,
    conflicts,
    untagged,
    wrapped: wrapped.length,
    total: operations.length,
  };
}

/** Name hey-api and the code-mode lists use: `service.camelCaseOperationId`. */
function camelName(operation: SpecOperation): string {
  return `${operation.service}.${operation.operationId.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}`;
}

function mostCommon(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();

  for (const value of values) {
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  // Ties go to the alphabetically first group, so reruns are stable.
  return [...counts].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )[0]?.[0];
}

function segments(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/** Group of the same service's wrapped operation sharing the longest literal path prefix. */
function neighbourGroup(
  operation: SpecOperation,
  wrapped: SpecOperation[],
  permissions: Permissions
): string | undefined {
  const own = segments(operation.path);
  let best: { length: number; groups: string[] } = { length: 0, groups: [] };

  for (const other of wrapped) {
    if (other.service !== operation.service) continue;

    const theirs = segments(other.path);
    let length = 0;

    while (
      length < own.length &&
      own[length] === theirs[length] &&
      !own[length]?.startsWith('{')
    )
      length++;

    if (length === 0 || length < best.length) continue;

    const group = permissions[other.name]?.group;
    if (!group) continue;

    if (length > best.length) best = { length, groups: [group] };
    else best.groups.push(group);
  }

  return mostCommon(best.groups);
}

function fallbackGroup(operation: SpecOperation): string {
  const groups = FALLBACK_GROUPS[operation.service];
  const first = segments(operation.path)[0] ?? '';
  const group = groups?.[first] ?? groups?.['*'];

  if (!group) throw new Error(`no fallback group for ${operation.name}`);

  return group;
}

if (import.meta.main) {
  const force = process.argv.includes('--force');

  if (existsSync(permissionsPath) && !force) {
    console.error(
      `${relative(process.cwd(), permissionsPath)} exists and holds hand edits; pass --force to overwrite it`
    );
    process.exit(1);
  }

  const { permissions, conflicts, untagged, wrapped, total } = seed();

  writeFileSync(permissionsPath, `${JSON.stringify(permissions, null, 2)}\n`);

  console.log(
    `wrote ${total} operations to ${relative(process.cwd(), permissionsPath)}`
  );
  console.log(
    `seeded from SDK tags: ${wrapped}; by HTTP method: ${total - wrapped}`
  );

  for (const action of ACTIONS) {
    console.log(
      `  ${action}: ${Object.values(permissions).filter((entry) => entry.action === action).length}`
    );
  }

  console.log(`conflicts (${conflicts.length}):`);
  for (const conflict of conflicts) console.log(`  ${conflict}`);

  console.log(
    `called by the SDK only from untagged code (${untagged.length}): ${untagged.join(', ')}`
  );
}
