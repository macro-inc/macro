// Fixed synthetic JSON corpus for all registered Macro nodes, using the actual TS classes.
// Run from repository root with Bun; only the JSON route is WP25/26.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(
  /\/$/,
  ''
);

import { mock, setSystemTime } from 'bun:test';

setSystemTime(new Date('2026-11-07T12:00:00.000Z'));
mock.module(
  createRequire(root + '/packages/lexical-core/nodes/AwaitNode.ts').resolve(
    'nanoid'
  ),
  () => ({ nanoid: (size = 21) => 'u'.repeat(size) })
);
const { SupportedNodeTypes, NodeReplacements, RegisteredNodesByType } =
  await import(root + '/packages/lexical-core/node-list.ts');
const { createHeadlessEditor } = await import(
  root + '/node_modules/@lexical/headless/dist/LexicalHeadless.node.mjs'
);
const L = await import(root + '/node_modules/lexical/dist/Lexical.node.mjs');
type RawNode = Record<string, unknown>;
type Case = {
  name: string;
  type: string;
  profile: string;
  input: { root: RawNode };
  json?: string;
  error?: string;
};
const text = (value = 'child'): RawNode => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text: value,
  type: 'text',
  version: 1,
});
const element = (
  type: string,
  children: RawNode[] = [],
  own: RawNode = {}
): RawNode => ({
  children,
  direction: 'rtl',
  format: 'right',
  indent: 2,
  type,
  version: 1,
  textFormat: 1,
  textStyle: 'color:red',
  ...own,
});
const samples: Record<string, RawNode> = {
  'account-manager-request': {
    grantId: '00000000-0000-4000-8000-000000000001',
  },
  'agent-activity': {
    agentSessionId: 'session',
    turn: 0,
    segment: 1,
    rows: [
      {
        id: 'row',
        label: 'Ran',
        status: 'completed',
        detail: 'cmd',
        card: null,
        extra: 'kept',
      },
    ],
    sealed: true,
    extra: 'kept',
  },
  'agent-context': { text: 'private' },
  'agent-session-mention': {
    id: 'session',
    label: 'session label',
    mentionUuid: 'mention',
    expanded: true,
  },
  await: { awaitId: 'await-id', text: 'loading', inline: false },
  'booking-link-mention': {
    profileId: 'profile',
    slug: 'slot',
    label: 'Book',
    url: 'https://example.com/booking',
  },
  'classed-block': {
    tag: 'blockquote',
    classes: ['callout', 'a b'],
    attributes: { 'data-x': 'value' },
  },
  'comment-mark': { ids: ['mark', 'second'], threadId: 42, isDraft: true },
  completion: { isTransparent: false },
  'connect-app': { appSlug: 'app', name: 'App', target: 'harness' },
  'contact-mention': {
    contactId: 'contact',
    name: 'Example, Alex Q.',
    emailOrDomain: 'user@example.com',
    isCompany: false,
    mentionUuid: 'mention',
  },
  'system-notification': {
    source: 'source',
    attributes: { 'data-key': 'value' },
    text: 'notification',
  },
  'custom-code': { language: 'js', theme: 'dark', previewEnabled: true },
  'database-query': {
    queryId: 'query',
    databaseId: 'database',
    tableId: 'table',
    title: 'Open &amp; ready',
    prompt: 'Count &lt; now',
    displayMode: 'bar',
    chart: {
      x: 'name',
      y: ['count'],
      title: 'chart',
      color: 'color',
      stack: true,
    },
    height: 400,
  },
  'date-mention': {
    date: '2026-11-07',
    displayFormat: 'Nov 7, 2026',
    mentionUuid: 'mention',
  },
  'diff-delete': {},
  'diff-insert': { markdown: 'new **text**' },
  diff: { userId: 'user', label: 'suggestion' },
  'diff-text': { diffStatus: 'insert', author: 'author' },
  'document-card': {
    documentId: 'document',
    documentName: 'Name',
    blockName: 'md',
    blockParams: { '2': 'two', z: 'last', '1': 'one' },
    previewBox: ['100%', 400],
    previewData: { view: { x: 1, y: 2, scale: 0.5 } },
    mentionUuid: 'mention',
  },
  'document-mention': {
    documentId: 'document',
    documentName: 'Name',
    blockName: 'md',
    blockParams: { key: 'value' },
    mentionUuid: 'mention',
    collapsed: true,
    channelType: 'channel',
    createdAt: 1794052800000,
  },
  equation: { equation: 'x^2', inline: false },
  'group-mention': { groupAlias: 'everyone' },
  horizontalrule: {},
  'html-render': { html: '<p>hello</p>', adaptColors: true },
  image: {
    srcType: 'url',
    id: 'image-id',
    url: 'https://example.com/image.png',
    width: 800,
    height: 600,
    scale: 1.25,
    constrainedWidth: 400,
    constrainedHeight: 300,
    alt: 'diagram',
  },
  video: {
    srcType: 'url',
    id: 'video-id',
    url: 'https://example.com/video.mp4',
    width: 1280,
    height: 720,
    scale: 1,
    controls: false,
  },
  'inline-search': {},
  'magic-chip': {
    agentSessionId: 'session',
    channelId: null,
    promptedMessage: null,
    status: 'acp_ready',
  },
  paste: { content: 'paste text', origin: 'referenced' },
  'pr-mention': {
    id: 'https://github.com/example/project/pull/42',
    label: 'Fix',
    mentionUuid: 'mention',
    url: '',
  },
  'reply-target': {
    parent: { type: 'channel', id: 'channel' },
    targetMessageId: 'message',
    targetThreadId: 'thread',
    displayText: 'Reply',
    senderId: 'sender',
  },
  'search-match': { ids: ['search'] },
  snapshot: {
    documentId: 'document',
    documentName: 'Name',
    blockName: 'md',
    content: 'snapshot',
    snapshotDate: '2026-11-07T12:00:00.000Z',
    mentionUuid: 'mention',
  },
  'tag-mention': {
    optionId: 'option',
    propertyDefinitionId: 'property',
    scope: 'team',
    name: 'urgent',
    color: '#f00',
  },
  'task-list': { listType: 'check', start: 3, tag: 'ul' },
  'theme-mention': {
    name: 'Dusk',
    data: { accent: '#123', '2': 'two', '1': 'one' },
  },
  'unknown-mention': { name: 'Unknown' },
  'unlinked-text': {},
  'user-mention': {
    userId: 'user',
    email: 'user@example.com',
    displayName: 'User',
    mentionUuid: 'mention',
  },
  watermark: { content: 'watermark' },
};
Object.assign(samples, {
  paragraph: {},
  text: {},
  tab: {},
  linebreak: {},
  code: { language: 'js', theme: 'dark' },
  heading: { tag: 'h2' },
  link: { url: 'https://example.com', rel: null, target: null, title: null },
  autolink: {
    url: 'https://example.com',
    rel: null,
    target: null,
    title: null,
    isUnlinked: false,
  },
  list: { listType: 'bullet', start: 1, tag: 'ul' },
  listitem: { value: 1, checked: true },
  quote: {},
  'code-highlight': { highlightType: 'keyword' },
  table: { colWidths: [100], rowStriping: true },
  tablecell: {
    headerState: 1,
    colSpan: 1,
    rowSpan: 1,
    width: 100,
    backgroundColor: '#fff',
  },
  tablerow: { height: 25 },
  mark: { ids: ['id'] },
});
const upstreamTypes = new Set([
  'paragraph',
  'text',
  'tab',
  'linebreak',
  'code',
  'heading',
  'link',
  'autolink',
  'list',
  'listitem',
  'quote',
  'code-highlight',
  'table',
  'tablecell',
  'tablerow',
  'mark',
]);
const nodeState = {
  id: 'node-id',
  peerId: 'peer-id',
  sharedPeerIds: ['peer', 'second'],
  extra: { kept: true },
  taskListView: { filters: { status: ['todo'], extra: 'kept' } },
};
const output: Case[] = [];
const ownUndefined: Record<string, string[]> = {};
const classTypes = Object.fromEntries(
  SupportedNodeTypes.map((klass) => [klass.name, klass.getType()])
);
for (const klass of SupportedNodeTypes) {
  const type = klass.getType();
  if (!(type in samples)) continue;
  const isElement = klass.prototype instanceof L.ElementNode;
  const isText = klass === L.TextNode || klass.prototype instanceof L.TextNode;
  const make = (own: RawNode): RawNode => ({
    ...(isElement
      ? element(type, [text()])
      : isText
        ? { ...text('node text'), type }
        : { type, version: 1 }),
    $: nodeState,
    ...own,
  });
  const base = make(samples[type]);
  if (type === 'tab') base.text = '\t';
  if (type === 'table')
    base.children = [
      element('tablerow', [
        element('tablecell', [element('paragraph', [text()])], {
          headerState: 0,
          colSpan: 1,
          rowSpan: 1,
          backgroundColor: null,
        }),
      ]),
    ];
  if (type === 'task-list' || type === 'list')
    base.children = [
      element('listitem', [text()], { value: 1, checked: true }),
    ];
  const variants: Array<[string, RawNode]> = upstreamTypes.has(type)
    ? [['full', base]]
    : [
        ['full', base],
        ['minimal', make({})],
      ];
  for (const field of upstreamTypes.has(type)
    ? []
    : Object.keys(samples[type])) {
    const absent = { ...base };
    delete absent[field];
    variants.push([`${field}-absent`, absent]);
    variants.push([`${field}-null`, { ...base, [field]: null }]);
    if (
      typeof samples[type][field] === 'string' &&
      ![
        'listType',
        'diffStatus',
        'status',
        'scope',
        'displayMode',
        'target',
      ].includes(field)
    )
      for (const value of ['', 'é 😀 <&> "', 'long '.repeat(100)])
        variants.push([
          `${field}-${value === '' ? 'empty' : value.length > 100 ? 'long' : 'unicode'}`,
          { ...base, [field]: value },
        ]);
  }
  if (type === 'database-query') {
    for (const stack of [undefined, null, false, true, 0, 'yes']) {
      variants.push([
        'chart-stack-' + String(stack),
        {
          ...base,
          chart: {
            x: 'category',
            y: ['count'],
            title: null,
            color: null,
            stack,
          },
        },
      ]);
    }
    for (const displayMode of [
      'scalar',
      'table',
      'bar',
      'line',
      'area',
      'scatter',
      'pie',
    ]) {
      variants.push(['mode-' + displayMode, { ...base, displayMode }]);
    }
  }
  if (type === 'custom-code') {
    for (const version of [0, 1, 2, 3]) {
      for (const language of ['js', 'svg', 'SVG', 'xml', 'unknown']) {
        variants.push([
          `legacy-${version}-${language}`,
          {
            ...base,
            version,
            language,
            children: [],
            code: 'legacy code',
            text: 'legacy text',
            previewEnabled: true,
          },
        ]);
      }
    }
  }
  if (type === 'agent-session-mention')
    variants.push(['expanded', { ...base, expanded: true }]);
  if (type === 'await') variants.push(['block', { ...base, inline: false }]);
  for (const state of [
    { id: '', peerId: 4, sharedPeerIds: 'bad', extra: 1 },
    { id: 0, peerId: '', sharedPeerIds: [], extra: 2 },
    {},
  ])
    variants.push(['state-' + JSON.stringify(state), { ...base, $: state }]);
  for (const [name, node] of variants) {
    for (const profile of ['export', 'headless']) {
      const input = { root: element('root', [element('paragraph', [node])]) };
      const editor = createHeadlessEditor({
        namespace: 'macro-json-oracle',
        nodes: [
          ...SupportedNodeTypes,
          ...(profile === 'headless' ? NodeReplacements : []),
        ],
        onError(e) {
          throw e;
        },
      });
      try {
        const state = editor.parseEditorState(JSON.stringify(input));
        state.read(() => {
          for (const node of state._nodeMap.values()) {
            const exported = node.exportJSON();
            const fields = Object.keys(exported).filter(
              (field) => exported[field] === undefined
            );
            ownUndefined[node.getType()] = [
              ...new Set([...(ownUndefined[node.getType()] ?? []), ...fields]),
            ];
          }
        });
        output.push({
          name: `${type}:${name}:${profile}`,
          type,
          profile,
          input,
          json: JSON.stringify(state.toJSON()),
        });
      } catch (error) {
        output.push({
          name: `${type}:${name}:${profile}`,
          type,
          profile,
          input,
          error: String(error instanceof Error ? error.message : error),
        });
      }
    }
  }
  for (const parent of ['quote', 'listitem', 'tablecell']) {
    const node = structuredClone(base);
    const wrapped =
      parent === 'listitem'
        ? element('list', [element('listitem', [node], { value: 1 })], {
            listType: 'bullet',
            start: 1,
            tag: 'ul',
          })
        : parent === 'tablecell'
          ? element('table', [
              element('tablerow', [
                element('tablecell', [node], {
                  colSpan: 1,
                  rowSpan: 1,
                  headerState: 0,
                  backgroundColor: null,
                }),
              ]),
            ])
          : element('quote', [node]);
    const input = { root: element('root', [wrapped]) };
    const editor = createHeadlessEditor({
      namespace: 'macro-json-oracle',
      nodes: SupportedNodeTypes,
      onError(e) {
        throw e;
      },
    });
    try {
      output.push({
        name: `${type}:nested-${parent}`,
        type,
        profile: 'export',
        input,
        json: JSON.stringify(
          editor.parseEditorState(JSON.stringify(input)).toJSON()
        ),
      });
    } catch (error) {
      output.push({
        name: `${type}:nested-${parent}`,
        type,
        profile: 'export',
        input,
        error: String(error instanceof Error ? error.message : error),
      });
    }
  }
}

const destination = 'crates/client/lexical/macro_document_model/tests/corpus/';
function persist(name: string, contents: string) {
  if (process.argv.includes('--check')) {
    if (readFileSync(destination + name, 'utf8') !== contents)
      throw new Error(`Macro fixture drift: ${name}`);
  } else {
    mkdirSync(destination, { recursive: true });
    writeFileSync(destination + name, contents);
  }
}
persist(
  'nodes.jsonl',
  output.map((row) => JSON.stringify(row)).join('\n') + '\n'
);
// Constructor exports expose optional own properties that JSON import defaults fill.
const constructorEditor = createHeadlessEditor({
  nodes: SupportedNodeTypes,
  onError(error) {
    throw error;
  },
});
constructorEditor.update(
  () => {
    for (const klass of SupportedNodeTypes) {
      for (const args of [[], [{}]]) {
        try {
          const node = Reflect.construct(klass, args);
          const exported = node.exportJSON();
          const fields = Object.keys(exported).filter(
            (field) => exported[field] === undefined
          );
          ownUndefined[node.getType()] = [
            ...new Set([...(ownUndefined[node.getType()] ?? []), ...fields]),
          ];
        } catch {
          /* A constructor can require validated data; imported cases cover it. */
        }
      }
    }
  },
  { discrete: true }
);
const configurations = [
  ['export', SupportedNodeTypes],
  ['headless', [...SupportedNodeTypes, ...NodeReplacements]],
  ...Object.entries(RegisteredNodesByType).map(([name, nodes]) => [
    name,
    [
      ...nodes,
      ...NodeReplacements.filter(
        (replacement) =>
          nodes.includes(replacement.replace) &&
          nodes.includes(replacement.withKlass)
      ),
    ],
  ]),
];
const registries = configurations.map(([name, nodes]) => {
  const editor = createHeadlessEditor({
    nodes,
    onError(error: Error) {
      throw error;
    },
  });
  const replacements = Object.fromEntries(
    Array.from(editor._nodes.entries())
      .filter(([, entry]) => entry.replaceWithKlass)
      .map(([type, entry]) => [type, entry.replaceWithKlass.getType()])
  );
  return { name, types: Array.from(editor._nodes.keys()).sort(), replacements };
});
persist('registries.json', JSON.stringify(registries, null, 2) + '\n');
persist(
  'wire-properties.json',
  JSON.stringify({ classTypes, ownUndefined }, null, 2) + '\n'
);
console.log(
  `Checked ${output.length} JSON cases for ${new Set(output.map((row) => row.type)).size} registered nodes (41 custom)`
);
