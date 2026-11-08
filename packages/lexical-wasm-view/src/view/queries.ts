import type { EditorPort } from './port';
import type { EditorView } from './editor-view';
import type { ViewNode } from './types';

/** Bulk crossings only; view-only navigation reads the local mirror. */
export class BulkQueries {
  constructor(
    private readonly view: EditorView,
    private readonly port: EditorPort
  ) {}
  html(): string {
    return this.port.query({ kind: 0, key: 0, text: '', flags: 0 }).text;
  }
  markdownSelection(): string {
    return this.port.query({ kind: 1, key: 0, text: '', flags: 0 }).text;
  }
  findMatches(pattern: string, flags = 0) {
    return this.port.query({ kind: 2, key: 0, text: pattern, flags });
  }
  wordCount(): number {
    return this.port.query({ kind: 3, key: 0, text: '', flags: 0 }).count;
  }
  nodesOfType(type: string): readonly ViewNode[] {
    return [...this.view.mirror.values()].filter((node) => node.type === type);
  }
  keyForNodeId(id: string): number | null {
    const keys = this.port.query({ kind: 5, key: 0, text: id, flags: 0 }).keys;
    return keys[0] ?? null;
  }
  metadata() {
    return this.port.query({ kind: 6, key: 0, text: '', flags: 0 });
  }
  serializedState(): string {
    return this.port.query({ kind: 7, key: 0, text: '', flags: 0 }).text;
  }
}
