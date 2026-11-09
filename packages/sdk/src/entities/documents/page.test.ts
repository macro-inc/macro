import { describe, expect, test } from 'bun:test';
import type { DocumentBuildResponse } from '../../../generated/agent-harness/types.gen';
import type { MacroClient } from '../../utils/client';
import { DocumentNamespace } from './namespace';

const PAGE =
  '<script type="text/macro" id="tasks" lang="ts">export default async () => 1;</script>';

interface Requests {
  uploads: { fileName: string; text: string }[];
  saves: { documentId: string; text: string }[];
  builds: string[];
}

/** A client whose builds answer, in order, with `builds`. */
function clientBuilding(builds: DocumentBuildResponse[]): {
  client: MacroClient;
  requests: Requests;
} {
  const requests: Requests = { uploads: [], saves: [], builds: [] };
  const client = {
    storage: {
      uploadFile: async (request: {
        query: { fileName: string };
        body: Blob;
      }) => {
        requests.uploads.push({
          fileName: request.query.fileName,
          text: await request.body.text(),
        });
        return { data: { documentId: 'page' }, response: { status: 200 } };
      },
      getDocument: async () => ({
        data: { data: { documentMetadata: { fileType: 'html' } } },
        response: { status: 200 },
      }),
      simpleSave: async (request: {
        path: { document_id: string };
        body: { file: Blob };
      }) => {
        requests.saves.push({
          documentId: request.path.document_id,
          text: await request.body.file.text(),
        });
        return { data: { data: {} }, response: { status: 200 } };
      },
    },
    agentHarness: {
      getDocumentBuild: async (request: { path: { document_id: string } }) => {
        requests.builds.push(request.path.document_id);
        return { data: builds.shift(), response: { status: 200 } };
      },
    },
  } as unknown as MacroClient;
  return { client, requests };
}

describe('documents.publishPage', () => {
  test('returns the build problems by block, then a republish that builds returns none', async () => {
    const { client, requests } = clientBuilding([
      {
        status: 'failed',
        sourceHash: 'first',
        diagnostics: [
          {
            file: 'client script',
            message:
              "Argument of type 'number' is not assignable to parameter of type 'string'. at 3:20",
          },
          { file: null, message: 'a page holds at most 16 programs' },
        ],
      },
      {
        status: 'built',
        sourceHash: 'second',
        html: '<p></p>',
        programs: ['tasks'],
      },
    ]);

    const published = await new DocumentNamespace(client).publishPage({
      name: 'Launch tasks',
      html: PAGE,
    });

    expect(requests.uploads).toEqual([
      { fileName: 'Launch tasks.html', text: PAGE },
    ]);
    expect(published.document.id).toBe('page');
    expect(published.problems).toEqual([
      {
        block: 'client script',
        message:
          "Argument of type 'number' is not assignable to parameter of type 'string'. at 3:20",
      },
      { message: 'a page holds at most 16 programs' },
    ]);

    const fixed = `${PAGE}<p>fixed</p>`;
    const republished = await published.document.republishPage(fixed);

    expect(requests.saves).toEqual([{ documentId: 'page', text: fixed }]);
    expect(requests.uploads).toHaveLength(1);
    expect(requests.builds).toEqual(['page', 'page']);
    expect(republished.document).toBe(published.document);
    expect(republished.problems).toEqual([]);
  });
});
