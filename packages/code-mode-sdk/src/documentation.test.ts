import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  type AgentNotes,
  packageEntityDocs,
  type SdkDocs,
} from '../scripts/typedoc';

// Written by `bun run generate`, which `bun run test` runs first.
const artifact = new URL('../dist/documentation.json', import.meta.url);

const NAMESPACE = `# Class: ExampleNamespace

## Constructors

### Constructor

> **new ExampleNamespace**(\`client\`): \`ExampleNamespace\`

## Methods

### create()

> **create**(\`opts\`): \`Promise\`\\<[\`Example\`](../../example/classes/Example.md)\\>

Create an example. It is shared.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| \`opts\` | [\`Request\`](../../../../../generated/example/types.gen/type-aliases/Request.md) |

***

### byId()

> **byId**(\`id\`): [\`Example\`](../../example/classes/Example.md)

A handle by id.
`;

const EXAMPLE = `# Class: Example

An example handle.

## Extends

- [\`Base\`](../../../entity/classes/Base.md)

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-id"></a> \`id\` | \`readonly\` | \`string\` | - | [\`Base\`](../../../entity/classes/Base.md).[\`id\`](../../../entity/classes/Base.md#property-id) |

## Methods

### rename()

> **rename**(\`name\`): \`Promise\`\\<\`void\`\\>

Rename it.

#### Inherited from

[\`Base\`](../../../entity/classes/Base.md).[\`rename\`](../../../entity/classes/Base.md#rename)
`;

function fixturePages() {
  return new Map([
    ['src/entities/example/namespace/classes/ExampleNamespace.md', NAMESPACE],
    ['src/entities/example/example/classes/Example.md', EXAMPLE],
    [
      'src/entities/entity/classes/Base.md',
      '# Class: Base\n\nBase handle. [Child](../../../../generated/other/types.gen/type-aliases/Child.md)',
    ],
    [
      'generated/example/types.gen/type-aliases/Request.md',
      '# Request\n[child](Child.md)',
    ],
    [
      'generated/example/types.gen/type-aliases/Child.md',
      '# Child\n[cycle](Request.md)',
    ],
    [
      'generated/other/types.gen/type-aliases/Child.md',
      '# Child\nAnother service',
    ],
    [
      'src/macro/classes/Macro.md',
      '# Class: Macro\n\n## Properties\n\n| Property | Modifier | Type | Description |\n| ------ | ------ | ------ | ------ |\n| <a id="property-examplespace"></a> `exampleSpace` | `readonly` | [`ExampleNamespace`](../../entities/example/namespace/classes/ExampleNamespace.md) | Examples. |\n',
    ],
  ]);
}

const NOTES: AgentNotes[] = [
  {
    module: 'src/entities/example/namespace',
    name: 'ExampleNamespace',
    routing: 'Use when working with examples; not with anything else.',
    guide: 'Examples are shared with the whole team.',
  },
  {
    module: 'src/entities/entity',
    name: 'Base',
    routing: 'Use when building on entity handles; not for one area.',
  },
];

function pack(pages = fixturePages(), notes = NOTES) {
  return packageEntityDocs(pages, ['example'], notes);
}

describe('TypeDoc documentation packaging', () => {
  it('indexes an entity by symbol with signatures, summaries and its accessor', () => {
    const [entity] = pack().entities;
    expect(entity?.index).toContain(
      '### ExampleNamespace (`macro.exampleSpace`)'
    );
    expect(entity?.index).toContain(
      '- `ExampleNamespace.create`: create(opts): Promise<Example> — Create an example.'
    );
    expect(entity?.index).toContain('### Example\nAn example handle.');
    expect(entity?.index).toContain('Extends `Base`.\nFields: id');
    // Inherited methods are read on the class that declares them.
    expect(entity?.index).not.toContain('Example.rename');
    expect(entity?.index).not.toContain('Constructor');
  });

  it('splits classes into methods and names links by the symbol to read', () => {
    const { symbols } = pack();
    expect(symbols['ExampleNamespace.create']).toContain(
      '| `opts` | `Request` |'
    );
    expect(symbols['ExampleNamespace.create']).toContain(
      '`Promise`\\<`Example`\\>'
    );
    expect(symbols.ExampleNamespace).not.toContain('### create()');
    expect(symbols.ExampleNamespace).not.toContain('Constructor');
    expect(symbols.Example).toContain('| `Base.id` |');
    expect(symbols['Example.rename']).toContain('`Base.rename`');
    expect(Object.values(symbols).join('\n')).not.toContain('.md');
  });

  it('keeps transitive and cyclic wire references, qualifying shared names', () => {
    const { symbols } = pack();
    expect(symbols.Request).toBe('# Request\n`example.Child`');
    expect(symbols['example.Child']).toBe('# Child\n`Request`');
    expect(symbols['other.Child']).toBe('# Child\nAnother service');
  });

  it('fails generation on a missing referenced contract or missing namespace', () => {
    const pages = fixturePages();
    pages.delete('generated/example/types.gen/type-aliases/Child.md');
    expect(() => pack(pages)).toThrow('Broken TypeDoc link');
    expect(() => packageEntityDocs(new Map(), ['example'], NOTES)).toThrow(
      'no pages'
    );
  });

  it('describes each entity by its routing sentence and carries its agent guidance', () => {
    const { entities, symbols } = pack();
    const example = entities.find((entity) => entity.name === 'example');
    expect(example?.description).toBe(
      'Use when working with examples; not with anything else.'
    );
    expect(example?.guide).toBe('Examples are shared with the whole team.');
    expect(example?.index).toContain(
      'Use when working with examples; not with anything else.'
    );
    const core = entities.find((entity) => entity.name === 'core');
    expect(core?.guide).toBeUndefined();
    expect(symbols.ExampleNamespace).toContain(
      '## Agent guidance\n\nExamples are shared with the whole team.'
    );
    expect(symbols.Example).not.toContain('Agent guidance');
  });

  it('fails generation on an entity without exactly one routing sentence, or a stray note', () => {
    expect(() => pack(fixturePages(), NOTES.slice(0, 1))).toThrow(
      'SDK entity core needs exactly one @routing sentence'
    );
    const doubled: AgentNotes[] = [
      ...NOTES,
      {
        module: 'src/entities/example/example',
        name: 'Example',
        routing: 'Use when again; not twice.',
      },
    ];
    expect(() => pack(fixturePages(), doubled)).toThrow(
      'SDK entity example needs exactly one @routing sentence'
    );
    const stray: AgentNotes[] = [
      ...NOTES,
      { module: 'src/elsewhere', name: 'Lost', guide: 'Nobody reads this.' },
    ];
    expect(() => pack(fixturePages(), stray)).toThrow(
      '@routing or @agent outside every SDK entity: src/elsewhere#Lost'
    );
  });

  it('routes every real entity on a "Use when …; not …" sentence', async () => {
    const docs = JSON.parse(await readFile(artifact, 'utf8')) as SdkDocs;
    for (const doc of docs.entities) {
      expect(doc.description, doc.name).toMatch(/^Use when .+; not .+/);
      expect(doc.description.length, doc.name).toBeLessThanOrEqual(300);
    }
    const guide = (name: string) =>
      docs.entities.find((doc) => doc.name === name)?.guide ?? '';
    expect(guide('databases')).toContain("check every database's tables");
    expect(guide('crm')).toContain('not a Macro database');
    expect(guide('email')).toContain('Labels are per inbox');
    expect(guide('calendar')).toContain(
      'Booking links use conversational confirmation'
    );
    expect(guide('channels')).toContain('A form for a channel is a poll:');
    expect(guide('tasks')).toContain('Never edit, merge or delete');
    expect(guide('agentSessions')).toContain(
      'macro.agentSessions.createManaged'
    );
    expect(guide('routines')).toContain('never sees this conversation');
    expect(guide('documents')).toContain('<m-document-mention>');
    expect(guide('documents')).toContain('document.edit(instructions)');
    expect(guide('search')).toContain('macro.search.all');
    expect(guide('search')).toContain('macro.documents.search');
    expect(guide('search')).toContain('macro.workspace.page');
    expect(guide('core')).toBe('');
    expect(docs.symbols.DatabaseNamespace).toContain('## Agent guidance');
  });

  it('documents real public SDK handles in small indexes and references', async () => {
    const docs = JSON.parse(await readFile(artifact, 'utf8')) as SdkDocs;
    const entity = (name: string) => {
      const found = docs.entities.find((doc) => doc.name === name);
      if (!found) throw new Error(`Missing ${name} docs`);
      return found.index;
    };
    expect(entity('agentSessions')).toContain('### SessionReview');
    expect(entity('agentSessions')).toContain('`SessionReview.submitAll`');
    expect(docs.symbols.ReviewRecord_Serialize).toContain('presentedAt');
    expect(docs.symbols.SessionReview).not.toContain('property-parent');
    expect(docs.symbols.SessionReview).not.toContain('property-client');
    expect(docs.symbols.SessionReview).not.toContain('private constructor');
    expect(entity('documents')).toContain('`Document.content`');
    expect(entity('core')).toContain('### Macro');
    expect(docs.symbols.Macro).toContain('`agentSessions`');
    expect(docs.symbols.Macro).toContain('`search`');
    expect(docs.symbols.Macro).toContain('`workspace`');
    expect(docs.symbols.Macro).toContain('`chats`');
    expect(entity('routines')).toContain('`RoutineOptions`');
    expect(entity('harnesses')).toContain('### HarnessNamespace');
    expect(entity('agents')).not.toContain('HarnessNamespace');
    expect(entity('apiKeys')).toContain('### UserApiKey');
    expect(entity('entityMentions')).toContain('EntityMentionNamespace');
    expect(entity('githubPullRequests')).toContain('PullRequestChangeset');
    expect(entity('core')).toContain('`SharePermissionOptions`');
    expect(entity('search')).toContain('### SearchNamespace (`macro.search`)');
    expect(entity('search')).toContain('`SearchNamespace.all`');
    expect(entity('workspace')).toContain(
      '### WorkspaceNamespace (`macro.workspace`)'
    );
    expect(entity('chats')).toContain('### ChatNamespace (`macro.chats`)');
    expect(entity('chats')).toContain('`Chat.history`');
    expect(entity('core')).not.toContain('SearchNamespace');
    expect(docs.symbols.SearchOptions).toContain('agentSessions');
    expect(docs.symbols.WorkspaceType).toContain('agent_session');
    // Jev routes the catalog 32 entities per call, so every SDK directory is
    // its own entity, asked about with its own routing sentence.
    expect(docs.entities.length).toBeGreaterThan(32);
    expect(entity('unfurls')).toContain('### UnfurlNamespace');
    expect(entity('web')).not.toContain('UnfurlNamespace');
    expect(entity('pins')).toContain('### PinsNamespace');
    expect(entity('favorites')).not.toContain('PinsNamespace');
    expect(entity('images')).toContain('### ImagesNamespace');
    expect(entity('me')).toContain('### MeNamespace');
    for (const doc of docs.entities)
      expect(Buffer.byteLength(doc.index)).toBeLessThan(16 * 1024);
    for (const reference of Object.values(docs.symbols)) {
      expect(Buffer.byteLength(reference)).toBeLessThan(16 * 1024);
      expect(reference).not.toContain('/home/');
    }
  });
});

it('external chats and WhatsApp are their own entities without pairing methods', async () => {
  const docs = JSON.parse(await readFile(artifact, 'utf8')) as SdkDocs;
  const index = (name: string) =>
    docs.entities.find((entry) => entry.name === name)?.index;
  expect(index('externalChat')).toContain('ExternalChatsNamespace');
  expect(index('whatsapp')).toContain('WhatsAppNamespace');
  expect(index('whatsapp')).toContain('.chats`');
  expect(index('whatsapp')).not.toContain('whatsappConnect');
  expect(index('channels')).not.toContain('WhatsAppNamespace');
});
