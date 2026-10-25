import type { BrowserWorker } from '@cloudflare/puppeteer';
import {
  type Bounds,
  type GraphicsDocument,
  type TextFitRequest,
  type TextFitResult,
  worldBounds,
} from '@macro-inc/graphics';
import { Telemetry } from '@macro-inc/observability';
import PQueue from 'p-queue';
import { z } from 'zod';
import { withRenderPage } from './browser';
import { CanvasCache } from './cache';
import { overlaps } from './dependencies';
import { canonicalCanvasJson, canvasRevision } from './revision';

declare global {
  interface Window {
    resetCanvasSnapshot: () => void;
    prepareCanvasRender: () => Promise<void>;
    renderCanvasSnapshot: (snapshot: {
      document: GraphicsDocument;
      crop: Bounds;
      scale: number;
      revision: string;
    }) => Promise<void>;
    measureCanvasSnapshot: (snapshot: {
      document: GraphicsDocument;
      requests: TextFitRequest[];
    }) => Promise<TextFitResult>;
    readCanvasTextLayout: () => {
      id: string;
      bounds: Bounds;
      overflow: boolean;
    }[];
  }
}

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
export const canvasRenderOptions = z
  .object({
    itemIds: z.array(z.string().max(200)).min(1).max(100).optional(),
    crop: z
      .object({
        x: coordinate,
        y: coordinate,
        width: z.number().positive().max(1_000_000),
        height: z.number().positive().max(1_000_000),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CanvasRenderOptions = z.infer<typeof canvasRenderOptions>;
export type CanvasSnapshot = {
  documentId?: string;
  document: GraphicsDocument;
  clock: Record<string, number>;
};
export type CanvasRender = {
  revision: string;
  clock: Record<string, number>;
  crop: Bounds;
  width: number;
  height: number;
  objects: { id: string; bounds: Bounds }[];
  unavailable: { id: string; reason: string }[];
  textLayout: { id: string; bounds: Bounds; overflow: boolean }[];
  modelMedia: { type: 'image'; mediaType: 'image/png'; data: string }[];
};
export type CanvasMeasurer = (
  snapshot: CanvasSnapshot,
  requests: TextFitRequest[],
  signal?: AbortSignal
) => Promise<TextFitResult>;
export type CanvasRenderer = (
  snapshot: CanvasSnapshot,
  options?: CanvasRenderOptions,
  signal?: AbortSignal
) => Promise<CanvasRender>;
export type CanvasBrowserConfig = {
  BROWSER?: BrowserWorker;
  CANVAS_BROWSER_URL: string;
  CANVAS_RENDER_URL: string;
};

// Exact scene/crop/options/version keys; authorization always precedes lookup.
const RENDER_VERSION = 'canvas-dom-v2';
const renderCache = new CanvasCache<CanvasRender>(8, 16_000_000, 30_000);
const measurementCache = new CanvasCache<TextFitResult>(32, 8_000_000, 60_000);

/** Trusted configuration selects the single render surface. Models never supply URLs. */
export function createCanvasRenderer(
  config: CanvasBrowserConfig
): CanvasRenderer & { measure: CanvasMeasurer } {
  const browsers = new PQueue({ concurrency: 2 });
  const render: CanvasRenderer = async (snapshot, options = {}, signal) =>
    Telemetry.span('canvas.ai.render', async (span) => {
      signal?.throwIfAborted();
      const serialized = JSON.stringify(snapshot);
      if (serialized.length > 2_000_000)
        throw new Error('Canvas snapshot exceeds the 2 MB render limit.');
      const revision = await canvasRevision(snapshot);
      const key = snapshot.documentId
        ? canonicalCanvasJson([
            RENDER_VERSION,
            config.CANVAS_RENDER_URL,
            snapshot.documentId,
            revision,
            options,
          ])
        : undefined;
      const cached = key ? renderCache.get(key) : undefined;
      span.setAttr('canvas.cache.hit', !!cached);
      if (cached) return cached;
      const { document } = snapshot;
      const shapes = Object.values(document.items).filter(
        (item) => item.type !== 'surface' && item.type !== 'group'
      );
      const selected = options.itemIds
        ? options.itemIds.map((id) => {
            if (!document.items[id] || document.items[id].type === 'surface')
              throw new Error(`Canvas item ${id} does not exist.`);
            return worldBounds(document, id);
          })
        : shapes.map((item) => worldBounds(document, item.id));
      const union = selected.length
        ? {
            x: Math.min(...selected.map((b) => b.x)),
            y: Math.min(...selected.map((b) => b.y)),
            width:
              Math.max(...selected.map((b) => b.x + b.width)) -
              Math.min(...selected.map((b) => b.x)),
            height:
              Math.max(...selected.map((b) => b.y + b.height)) -
              Math.min(...selected.map((b) => b.y)),
          }
        : { x: 0, y: 0, width: 640, height: 480 };
      const crop = options.crop ?? {
        x: union.x - 32,
        y: union.y - 32,
        width: Math.max(64, union.width + 64),
        height: Math.max(64, union.height + 64),
      };
      const scale = Math.min(2, 1600 / crop.width, 1200 / crop.height);
      if (scale < 0.01)
        throw new Error(
          'Canvas crop exceeds the renderer zoom limit. Request a smaller crop or selection.'
        );
      const width = Math.max(1, Math.ceil(crop.width * scale));
      const height = Math.max(1, Math.ceil(crop.height * scale));
      const objects = shapes
        .map((item) => ({
          id: item.id,
          bounds: worldBounds(document, item.id),
        }))
        .filter((item) => overlaps(item.bounds, crop));
      const unavailable = shapes
        .filter(
          (item) =>
            ['image', 'video', 'document'].includes(item.type) &&
            objects.some((object) => object.id === item.id)
        )
        .map((item) => ({
          id: item.id,
          reason:
            'Embedded content is unavailable to this scoped render; no referenced resource or external URL was fetched.',
        }));
      const result = await browsers.add(
        () =>
          withRenderPage(config, width, height, signal, async (page) => {
            await page.evaluate(
              async (payload) => {
                await window.renderCanvasSnapshot(payload);
                await window.document.fonts.ready;
              },
              { document, crop, scale, revision }
            );
            signal?.throwIfAborted();
            const data = await page.screenshot({
              type: 'png',
              encoding: 'base64',
            });
            const textLayout = await page.evaluate(() => {
              return window.readCanvasTextLayout();
            });
            if (data.length > 4_000_000)
              throw new Error(
                'Canvas image exceeds the 3 MB image limit. Request a smaller crop.'
              );
            span.setAttr('canvas.render.objects', objects.length);
            span.setAttr('canvas.render.bytes', data.length);
            const imageHash = await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(data)
            );
            span.setAttr(
              'canvas.render.image_sha256',
              Array.from(new Uint8Array(imageHash), (value) =>
                value.toString(16).padStart(2, '0')
              ).join('')
            );
            span.setAttr('canvas.render.native_images', 1);
            return {
              revision,
              clock: snapshot.clock,
              crop,
              width,
              height,
              objects,
              unavailable,
              textLayout: textLayout.filter((item) =>
                objects.some((object) => object.id === item.id)
              ),
              modelMedia: [
                {
                  type: 'image' as const,
                  mediaType: 'image/png' as const,
                  data,
                },
              ],
            };
          }),
        { signal }
      );
      if (key) renderCache.set(key, result);
      return result;
    });
  const measure: CanvasMeasurer = async (snapshot, requests, signal) =>
    Telemetry.span('canvas.ai.measure_text', async (span) => {
      if (!requests.length) return { document: snapshot.document, effects: [] };
      if (requests.length > 100 || JSON.stringify(snapshot).length > 2_000_000)
        throw new Error(
          'Canvas text measurement exceeds its bounded batch size.'
        );
      signal?.throwIfAborted();
      span.setAttr('canvas.text.targets', requests.length);
      const key = snapshot.documentId
        ? canonicalCanvasJson([
            RENDER_VERSION,
            config.CANVAS_RENDER_URL,
            snapshot.documentId,
            snapshot.document,
            requests,
          ])
        : undefined;
      const cached = key ? measurementCache.get(key) : undefined;
      span.setAttr('canvas.cache.hit', !!cached);
      if (cached) return cached;
      const result = await browsers.add(
        () =>
          withRenderPage(config, 1024, 768, signal, async (page) =>
            page.evaluate(
              async (payload) => {
                return await window.measureCanvasSnapshot(payload);
              },
              { document: snapshot.document, requests }
            )
          ),
        { signal }
      );
      if (key) measurementCache.set(key, result);
      return result;
    });
  return Object.assign(render, { measure });
}
