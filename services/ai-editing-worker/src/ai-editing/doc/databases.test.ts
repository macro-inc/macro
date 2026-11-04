import {
  $isDatabaseQueryNode,
  type DatabaseQueryNode,
} from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import {
  $isDocumentCardNode,
  type DocumentCardNode,
} from '@macro-inc/lexical-core/nodes/DocumentCardNode';
import { $getRoot, $isParagraphNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { read, setup } from '../ai-toolkit/_test-helpers';
import type { DatabaseQueryView } from '../editor';
import { serializeWithXml } from '../utils';
import { Doc } from './doc';

const CHART_BLOCK =
  '<m-db-query>{"queryId":"q-1","databaseId":"db-1","title":"By owner","prompt":"Projects per owner","displayMode":"bar","chart":{"x":"owner","y":["projects"]}}</m-db-query>';
const SCALAR_BLOCK =
  '<m-db-query>{"queryId":"q-2","databaseId":"db-1","prompt":"How many projects?","displayMode":"scalar"}</m-db-query>';
const DATABASE_CARD =
  '<m-document-card>{"documentId":"db-1","documentName":"Projects","blockName":"database","blockParams":{"tableId":"table-1","viewId":"view-1"}}</m-document-card>';

/** Every database answer in the document, block or inside a paragraph. */
function queryNodes(session: ReturnType<typeof setup>['session']) {
  return read(session, () =>
    $getRoot()
      .getChildren()
      .flatMap((child) =>
        $isParagraphNode(child) ? child.getChildren() : [child]
      )
      .filter($isDatabaseQueryNode)
      .map((node: DatabaseQueryNode) => node.exportComponentProps())
  );
}

describe('Doc — database answers and charts', () => {
  it('inserts a chart block from its <m-db-query> markdown', () => {
    const { session, ids } = setup('intro');
    new Doc(session).apply({
      kind: 'insertNode',
      ref: 'chart',
      spec: { block: 'database-query', query: CHART_BLOCK },
      at: { after: ids[0]! },
    });
    expect(
      read(session, () => {
        const node = $getRoot().getChildren()[1];
        return $isDatabaseQueryNode(node) ? node.exportComponentProps() : null;
      })
    ).toEqual({
      queryId: 'q-1',
      databaseId: 'db-1',
      title: 'By owner',
      prompt: 'Projects per owner',
      displayMode: 'bar',
      chart: { x: 'owner', y: ['projects'] },
    });
    expect(serializeWithXml(session)).toContain(
      '<database-query id="chart" queryId="q-1"'
    );
  });

  it('inserts a scalar answer inside a sentence', () => {
    const { session, ids } = setup('Total: projects');
    new Doc(session).apply({
      kind: 'insertInline',
      ref: 'n',
      node: ids[0]!,
      at: 7,
      spec: { inline: 'database-query', query: SCALAR_BLOCK },
    });
    expect(
      read(session, () =>
        $getRoot()
          .getChildren()
          .flatMap((child) =>
            $isParagraphNode(child) ? child.getChildren() : [child]
          )
          .map((node) => node.getType())
      )
    ).toEqual(['text', 'database-query', 'text']);
  });

  it('refuses a table or chart inside a sentence', () => {
    const { session, ids } = setup('Total: projects');
    expect(() =>
      new Doc(session).apply({
        kind: 'insertInline',
        ref: 'n',
        node: ids[0]!,
        at: 7,
        spec: { inline: 'database-query', query: CHART_BLOCK },
      })
    ).toThrow(/only a scalar answer sits inside text/);
  });

  it('refuses text that is not a saved database question', () => {
    const { session, ids } = setup('intro');
    const doc = new Doc(session);
    for (const query of [
      'SELECT count(*) FROM projects',
      '<m-db-query>{"queryId":"","prompt":"draft","displayMode":"table"}</m-db-query>',
      '<m-db-query>{"queryId":"q","prompt":"p","displayMode":"bar"}</m-db-query>',
    ]) {
      expect(() =>
        doc.apply({
          kind: 'insertNode',
          ref: 'chart',
          spec: { block: 'database-query', query },
          at: { after: ids[0]! },
        })
      ).toThrow(/<m-db-query>/);
    }
    expect(queryNodes(session)).toEqual([]);
  });

  it('switches a chart to another chart type, keeping the saved question', () => {
    const { session } = setup(CHART_BLOCK);
    const nodeId = /<database-query id="([^"]+)"/.exec(
      serializeWithXml(session)
    )![1]!;
    new Doc(session).apply({
      kind: 'setDatabaseQueryView',
      node: nodeId,
      view: { displayMode: 'line', title: 'Owner trend', height: 360 },
    });
    expect(queryNodes(session)).toEqual([
      {
        queryId: 'q-1',
        databaseId: 'db-1',
        title: 'Owner trend',
        prompt: 'Projects per owner',
        displayMode: 'line',
        chart: { x: 'owner', y: ['projects'] },
        height: 360,
      },
    ]);
  });

  it('clears a title and turns a chart into a table', () => {
    const { session } = setup(CHART_BLOCK);
    const nodeId = /<database-query id="([^"]+)"/.exec(
      serializeWithXml(session)
    )![1]!;
    new Doc(session).apply({
      kind: 'setDatabaseQueryView',
      node: nodeId,
      view: { displayMode: 'table', title: null, chart: null },
    });
    expect(queryNodes(session)).toEqual([
      {
        queryId: 'q-1',
        databaseId: 'db-1',
        prompt: 'Projects per owner',
        displayMode: 'table',
      },
    ]);
  });

  it('refuses a view the renderer cannot draw and leaves the chart unchanged', () => {
    const { session } = setup(`${SCALAR_BLOCK}\n\n${CHART_BLOCK}`);
    const [scalarId, chartId] = [
      ...serializeWithXml(session).matchAll(/<database-query id="([^"]+)"/g),
    ].map((found) => found[1]!);
    const doc = new Doc(session);
    expect(() =>
      doc.apply({
        kind: 'setDatabaseQueryView',
        node: chartId!,
        view: { chart: null },
      })
    ).toThrow(/needs chart/);
    expect(() =>
      doc.apply({
        kind: 'setDatabaseQueryView',
        node: chartId!,
        view: { displayMode: 'scalar' },
      })
    ).toThrow(/scalar/);
    expect(() =>
      doc.apply({
        kind: 'setDatabaseQueryView',
        node: chartId!,
        // Model code is untyped; a question field must never ride along.
        view: { title: 'Other', queryId: 'q-9' } as DatabaseQueryView,
      })
    ).toThrow(/cannot change queryId/);
    expect(() =>
      doc.apply({
        kind: 'setDatabaseQueryView',
        node: scalarId!,
        view: { displayMode: 'table' },
      })
    ).toThrow(/scalar/);
    expect(queryNodes(session)).toEqual([
      {
        queryId: 'q-2',
        databaseId: 'db-1',
        prompt: 'How many projects?',
        displayMode: 'scalar',
      },
      {
        queryId: 'q-1',
        databaseId: 'db-1',
        title: 'By owner',
        prompt: 'Projects per owner',
        displayMode: 'bar',
        chart: { x: 'owner', y: ['projects'] },
      },
    ]);
  });
});

describe('Doc — embedded databases', () => {
  it('switches an embedded database to another table and view', () => {
    const { session } = setup(DATABASE_CARD);
    const cardId = /<document-card id="([^"]+)"/.exec(
      serializeWithXml(session)
    )![1]!;
    const doc = new Doc(session);
    doc.apply({
      kind: 'setDatabaseLocation',
      node: cardId,
      tableId: 'table-2',
      viewId: 'view-9',
    });
    const params = () =>
      read(session, () => {
        const node = $getRoot().getChildren()[0];
        return $isDocumentCardNode(node)
          ? (node as DocumentCardNode).getBlockParams()
          : null;
      });
    expect(params()).toEqual({ tableId: 'table-2', viewId: 'view-9' });
    doc.apply({
      kind: 'setDatabaseLocation',
      node: cardId,
      tableId: 'table-3',
    });
    expect(params()).toEqual({ tableId: 'table-3', viewId: '' });
  });

  it('refuses to retarget a card that is not a database', () => {
    const { session } = setup(
      '<m-document-card>{"documentId":"doc-1","documentName":"Plan","blockName":"md"}</m-document-card>'
    );
    const cardId = /<document-card id="([^"]+)"/.exec(
      serializeWithXml(session)
    )![1]!;
    expect(() =>
      new Doc(session).apply({
        kind: 'setDatabaseLocation',
        node: cardId,
        tableId: 'table-2',
      })
    ).toThrow(/not an embedded database/);
  });
});
