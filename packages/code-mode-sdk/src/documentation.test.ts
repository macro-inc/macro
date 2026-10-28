import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { packageEntityDocs, type SdkDocs } from '../scripts/typedoc';

const artifact = new URL(
  '../../../crates/agent_code_mode/src/domain/documentation.json',
  import.meta.url
);

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

function pack(pages = fixturePages()) {
  return packageEntityDocs(pages, { example: 'An example.' });
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

  it('omits legacy namespaces without removing adjacent current session methods', () => {
    const pages = fixturePages();
    pages.set(
      'src/macro/classes/Macro.md',
      '# Class: Macro\n\n## Methods\n\n### chats()\n[Chats](../../entities/chats/namespace/classes/Chats.md)\n\n### agentSessions()\n\nCurrent sessions\n\n### workspace()\n\nLegacy feed'
    );
    const { symbols } = pack(pages);
    expect(symbols['Macro.agentSessions']).toContain('Current sessions');
    expect(symbols['Macro.chats']).toBeUndefined();
    expect(symbols['Macro.workspace']).toBeUndefined();
  });

  it('fails generation on a missing referenced contract or missing namespace', () => {
    const pages = fixturePages();
    pages.delete('generated/example/types.gen/type-aliases/Child.md');
    expect(() => pack(pages)).toThrow('Broken TypeDoc link');
    expect(() =>
      packageEntityDocs(new Map(), { example: 'An example.' })
    ).toThrow('no pages');
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
    expect(docs.symbols.ReviewRecord).toContain('presentedAt');
    expect(docs.symbols.SessionReview).not.toContain('property-parent');
    expect(docs.symbols.SessionReview).not.toContain('property-client');
    expect(docs.symbols.SessionReview).not.toContain('private constructor');
    expect(entity('documents')).toContain('`Document.content`');
    expect(entity('core')).toContain('### Macro');
    expect(docs.symbols.Macro).toContain('`agentSessions`');
    expect(docs.symbols.Macro).not.toContain('property-chats');
    expect(docs.symbols.Macro).not.toContain('property-workspace');
    expect(entity('routines')).toContain('`RoutineOptions`');
    expect(entity('agents')).toContain('### HarnessNamespace');
    expect(entity('apiKeys')).toContain('### UserApiKey');
    expect(entity('entityMentions')).toContain('EntityMentionNamespace');
    expect(entity('githubPullRequests')).toContain('PullRequestChangeset');
    expect(entity('core')).toContain('`SharePermissionOptions`');
    expect(
      docs.entities.some((doc) => ['chats', 'workspace'].includes(doc.name))
    ).toBe(false);
    expect(docs.entities.length).toBeLessThanOrEqual(32);
    for (const doc of docs.entities)
      expect(Buffer.byteLength(doc.index)).toBeLessThan(16 * 1024);
    for (const reference of Object.values(docs.symbols)) {
      expect(Buffer.byteLength(reference)).toBeLessThan(16 * 1024);
      expect(reference).not.toContain('/home/');
    }
  });
});

it('external chats and WhatsApp share the channels discovery topic without pairing methods', async () => {
  const docs = JSON.parse(await readFile(artifact, 'utf8')) as SdkDocs;
  const channels = docs.entities.find((entry) => entry.name === 'channels');
  expect(channels?.index).toContain('ExternalChatsNamespace');
  expect(channels?.index).toContain('ExternalChat');
  expect(channels?.index).toContain('WhatsAppNamespace');
  expect(channels?.index).toContain('.chats`');
  expect(channels?.index).not.toContain('whatsappConnect');
});
