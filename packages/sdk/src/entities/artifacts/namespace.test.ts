import { afterEach, describe, expect, test } from 'bun:test';
import type {
  ArtifactResponse,
  ArtifactUploadsRequest,
  ArtifactVersionResponse,
  CreateArtifactRequest,
  PlaceArtifactRequest,
  PublishVersionRequest,
} from '../../../generated/storage/types.gen';
import { MacroError } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { Artifact, ArtifactScene } from './artifact';
import { contentTypeOf, sha256Hex } from './bundle';
import { ArtifactNamespace } from './namespace';

const WEB = 'https://macro.test';
const ARTIFACT = '0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f';
const PAGE = '<h1>Hi</h1>';
const PAGE_SHA =
  '0f8ca7467b0a55599c03aad0aed980d35f15acafcfa344cfdcd152af3044f7e8';
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function version(
  number: number,
  files: ArtifactVersionResponse['files'],
): ArtifactVersionResponse {
  return {
    number,
    files,
    scenes: [{ id: 'empty', title: 'Empty', path: 'index.html' }],
    created_by: 'macro|alice@macro.test',
    created_by_agent: 'bot-1',
    created_at: '2026-11-04T12:00:00Z',
  };
}

function artifactResponse(current: ArtifactVersionResponse | null) {
  return {
    document_id: ARTIFACT,
    name: 'Onboarding',
    owner: 'macro|alice@macro.test',
    current,
  } satisfies ArtifactResponse;
}

describe('artifacts.create', () => {
  test('sends a small bundle inline in one request with hashed, typed files', async () => {
    const requests: CreateArtifactRequest[] = [];
    const client = {
      webAppUrl: WEB,
      storage: {
        createArtifact: async ({ body }: { body: CreateArtifactRequest }) => {
          requests.push(body);
          return { data: artifactResponse(null) };
        },
      },
    } as unknown as MacroClient;

    const artifact = await new ArtifactNamespace(client).create({
      name: 'Onboarding',
      files: { 'index.html': PAGE, 'logo.png': new Uint8Array([1, 2, 3]) },
      scenes: [{ id: 'empty', title: 'Empty', path: 'index.html' }],
    });

    expect(requests).toEqual([
      {
        name: 'Onboarding',
        project_id: null,
        message: null,
        scenes: [{ id: 'empty', title: 'Empty', path: 'index.html' }],
        files: [
          {
            path: 'index.html',
            content_type: 'text/html',
            sha256: PAGE_SHA,
            content_base64: btoa(PAGE),
          },
          {
            path: 'logo.png',
            content_type: 'image/png',
            sha256: await sha256Hex(new Uint8Array([1, 2, 3])),
            content_base64: 'AQID',
          },
        ],
      },
    ]);
    expect(artifact.webUrl()).toBe(`${WEB}/app/artifact/${ARTIFACT}`);
  });

  test('refuses files whose extension has no allowed content type', () => {
    expect(() => contentTypeOf('notes.docx')).toThrow(MacroError);
    expect(() => contentTypeOf('Makefile')).toThrow(MacroError);
    expect(contentTypeOf('fonts/Inter.WOFF2')).toBe('font/woff2');
  });
});

describe('artifact.publish', () => {
  test('sends stored files by digest and only the missing ones inline', async () => {
    const uploadRequests: ArtifactUploadsRequest[] = [];
    const publishes: PublishVersionRequest[] = [];
    const client = {
      webAppUrl: WEB,
      storage: {
        createArtifactUploads: async ({
          body,
        }: {
          body: ArtifactUploadsRequest;
        }) => {
          uploadRequests.push(body);
          const missing = body.files.filter((file) => file.sha256 !== PAGE_SHA);
          return {
            data: {
              uploads: missing.map((file) => ({
                sha256: file.sha256,
                url: 'https://bucket.test/put',
                headers: {},
              })),
            },
          };
        },
        publishArtifactVersion: async ({
          body,
        }: {
          body: PublishVersionRequest;
        }) => {
          publishes.push(body);
          return { data: version(3, []) };
        },
      },
    } as unknown as MacroClient;
    const artifact = Artifact.from(
      client,
      artifactResponse(
        version(2, [
          {
            path: 'index.html',
            sha256: PAGE_SHA,
            size: PAGE.length,
            content_type: 'text/html',
          },
        ]),
      ),
    );

    const published = await artifact.publish({
      files: { 'index.html': PAGE, 'app.css': 'body{}' },
      baseVersion: await artifact.currentVersion(),
      message: 'Style it',
    });

    expect(uploadRequests[0]?.files.map((file) => file.content_type)).toEqual([
      'text/html',
      'text/css',
    ]);
    expect(publishes).toEqual([
      {
        scenes: [],
        message: 'Style it',
        base_version: 2,
        files: [
          { path: 'index.html', content_type: 'text/html', sha256: PAGE_SHA },
          {
            path: 'app.css',
            content_type: 'text/css',
            sha256: await sha256Hex(new TextEncoder().encode('body{}')),
            content_base64: btoa('body{}'),
          },
        ],
      },
    ]);
    expect(published.number).toBe(3);
    expect(published.createdBy.id).toBe('macro|alice@macro.test');
    expect(published.createdByAgent?.id).toBe('bot-1');
  });

  test('moves the largest new files to presigned uploads above 32 MiB', async () => {
    const large = new Uint8Array(13 * 1024 * 1024).fill(7);
    const larger = new Uint8Array(14 * 1024 * 1024).fill(9);
    const largerSha = await sha256Hex(larger);
    const puts: { url: string; size: number }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      puts.push({
        url: String(url),
        size: (init?.body as Uint8Array).byteLength,
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const publishes: PublishVersionRequest[] = [];
    const client = {
      webAppUrl: WEB,
      storage: {
        createArtifactUploads: async ({
          body,
        }: {
          body: ArtifactUploadsRequest;
        }) => ({
          data: {
            uploads: body.files.map((file) => ({
              sha256: file.sha256,
              url: `https://bucket.test/${file.sha256}`,
              headers: { 'x-amz-checksum-sha256': 'checksum' },
            })),
          },
        }),
        publishArtifactVersion: async ({
          body,
        }: {
          body: PublishVersionRequest;
        }) => {
          publishes.push(body);
          return { data: version(1, []) };
        },
      },
    } as unknown as MacroClient;

    await Artifact.byId(client, ARTIFACT).publish({
      files: {
        'index.html': PAGE,
        'a.webm': large,
        'b.webm': larger,
      },
      baseVersion: 0,
    });

    expect(puts).toEqual([
      { url: `https://bucket.test/${largerSha}`, size: larger.byteLength },
    ]);
    const files = publishes[0]?.files ?? [];
    expect(files.find((file) => file.path === 'b.webm')?.content_base64).toBe(
      undefined,
    );
    expect(
      files.find((file) => file.path === 'a.webm')?.content_base64,
    ).toBeDefined();
    expect(publishes[0]?.base_version).toBe(0);
  });
});

describe('artifact.placeOn', () => {
  test('places a scene on a canvas handle at the UI default size', async () => {
    const places: PlaceArtifactRequest[] = [];
    const client = {
      webAppUrl: WEB,
      storage: {
        placeArtifact: async ({
          path,
          body,
        }: {
          path: { document_id: string };
          body: PlaceArtifactRequest;
        }) => {
          expect(path.document_id).toBe(ARTIFACT);
          places.push(body);
          return { data: { item_id: body.item_id } };
        },
      },
    } as unknown as MacroClient;
    const artifact = Artifact.byId(client, ARTIFACT);
    const canvas = Document.byId(client, 'canvas-1');
    const scene = new ArtifactScene(artifact, 2, {
      id: 'empty',
      title: 'Empty',
      path: 'empty.html',
    });

    const placement = await artifact.placeOn(canvas, { scene, x: 10, y: 20 });

    const itemId = places[0]?.item_id ?? '';
    expect(itemId).toMatch(/^[0-9a-f-]{36}$/);
    expect(places).toEqual([
      {
        item_id: itemId,
        canvas_id: 'canvas-1',
        scene: 'empty',
        x: 10,
        y: 20,
        width: 960,
        height: 600,
      },
    ]);
    expect(placement.itemId).toBe(itemId);
    expect(placement.canvas).toBe(canvas);
    expect(scene.webUrl()).toBe(`${WEB}/app/artifact/${ARTIFACT}?scene=empty`);
  });
  test('retries a lost response once with the same item id', async () => {
    const itemIds: (string | null | undefined)[] = [];
    let attempts = 0;
    const client = {
      webAppUrl: WEB,
      storage: {
        placeArtifact: async ({ body }: { body: PlaceArtifactRequest }) => {
          itemIds.push(body.item_id);
          attempts += 1;
          if (attempts === 1) throw new TypeError('connection reset');
          return { data: { item_id: body.item_id } };
        },
      },
    } as unknown as MacroClient;

    const placement = await Artifact.byId(client, ARTIFACT).placeOn(
      Document.byId(client, 'canvas-1'),
      { x: 0, y: 0 },
    );

    expect(itemIds).toHaveLength(2);
    expect(itemIds[0]).toBe(itemIds[1]);
    expect(placement.itemId).toBe(itemIds[0] ?? '');
  });
});

describe('artifact versions', () => {
  test('lists history as version handles and restores one', async () => {
    const restored: number[] = [];
    const client = {
      webAppUrl: WEB,
      storage: {
        listArtifactVersions: async () => ({
          data: {
            versions: [
              {
                number: 2,
                created_by: 'macro|alice@macro.test',
                created_at: '2026-11-04T12:00:00Z',
                file_count: 3,
                total_size: 120,
              },
            ],
          },
        }),
        getArtifactVersion: async ({ path }: { path: { number: number } }) => ({
          data: version(path.number, [
            {
              path: 'index.html',
              sha256: PAGE_SHA,
              size: 11,
              content_type: 'text/html',
            },
          ]),
        }),
        restoreArtifactVersion: async ({
          path,
        }: {
          path: { number: number };
        }) => {
          restored.push(path.number);
          return { data: version(3, []) };
        },
      },
    } as unknown as MacroClient;
    const artifact = Artifact.byId(client, ARTIFACT);

    const [second] = await artifact.versions();
    if (!second) throw new Error('no version');
    expect(second.fileCount).toBe(3);
    expect(second.createdByAgent).toBeUndefined();
    expect((await second.files())[0]?.contentType).toBe('text/html');
    expect((await second.scenes()).map((scene) => scene.id)).toEqual(['empty']);
    expect((await second.restore()).number).toBe(3);
    expect(restored).toEqual([2]);
  });
});
