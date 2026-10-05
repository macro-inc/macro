import { BlockRegistry } from '@core/block';
import { createHeadlessEditor } from '@lexical/headless';
import { DocumentMentionNode } from '@macro-inc/lexical-core';
import { describe, expect, it, vi } from 'vitest';
import { fileTypeToBlockName, verifyBlockName } from './allBlocks';

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const definitionFiles = import.meta.glob('../../../features/*/definition.ts', {
  eager: true,
  import: 'default',
  query: '?raw',
});

describe('block definition discovery', () => {
  it('has one definition file for every block', () => {
    const discoveredNames = Object.values(definitionFiles).map(
      (source) => String(source).match(/\bname:\s*['"]([^'"]+)['"]/)?.[1]
    );

    expect(discoveredNames.sort()).toEqual([...BlockRegistry].sort());
  });
});

it.each(['routine', 'automation'])(
  'reads stored %s mention nodes as routines without changing their serialization',
  (blockName) => {
    const editor = createHeadlessEditor({ nodes: [DocumentMentionNode] });
    editor.update(
      () => {
        const serialized = {
          type: 'document-mention',
          version: 2,
          documentId: 'routine-1',
          documentName: 'Review tasks',
          blockName,
          blockParams: {},
        };
        const node = DocumentMentionNode.importJSON(serialized);
        expect(verifyBlockName(node.getBlockName())).toBe('routine');
        expect(fileTypeToBlockName(node.getBlockName())).toBe('routine');
        expect(node.exportJSON()).toMatchObject(serialized);
        const element = node.exportDOM().element;
        const conversion = DocumentMentionNode.importDOM()
          ?.span(element)
          ?.conversion(element);
        expect(conversion?.node).toBeInstanceOf(DocumentMentionNode);
        if (!(conversion?.node instanceof DocumentMentionNode))
          throw new Error('Missing mention');
        expect(verifyBlockName(conversion.node.getBlockName())).toBe('routine');
        expect(conversion.node.exportJSON()).toMatchObject(serialized);
      },
      { discrete: true }
    );
  }
);
