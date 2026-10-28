import { type Bounds, worldBounds } from '@macro-inc/graphics';
import { Telemetry } from '@macro-inc/observability';
import {
  generateText,
  hasToolCall,
  type LanguageModel,
  type LanguageModelUsage,
  stepCountIs,
  tool,
} from 'ai';
import PQueue from 'p-queue';
import { z } from 'zod';
import { TokenTracker } from '../ai-editing/token-tracker';
import { runCanvasInSandbox } from '../sandbox';
import type { CanvasPresentation } from './animation';
import { dependencies } from './dependencies';
import { canvasOverview } from './overview';
import SYSTEM from './prompt.md';
import {
  type CanvasMeasurer,
  type CanvasRender,
  type CanvasRenderer,
  canvasRenderOptions,
} from './render';
import { canvasRevision } from './revision';
import {
  type CanvasSource,
  CanvasWriteError,
  describeCanvas,
  withCanvasSession,
} from './session';

export type CanvasAgentOptions = {
  render?: CanvasRenderer;
  createSource?: () => CanvasSource;
  measure?: CanvasMeasurer;
};

/** Native AI SDK6 image blocks; metadata never repeats encoded pixels in text. */
export function canvasModelOutput(output: CanvasRender) {
  const { modelMedia, ...metadata } = output;
  return {
    type: 'content' as const,
    value: [
      { type: 'text' as const, text: JSON.stringify(metadata) },
      ...modelMedia.map((image) => ({
        type: 'image-data' as const,
        data: image.data,
        mediaType: image.mediaType,
      })),
    ],
  };
}

async function canvasImageIdentity(image: string): Promise<string> {
  const data = image.startsWith('data:image/')
    ? image.slice(image.indexOf(',') + 1)
    : image;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(data)
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0')
  ).join('');
}

/** Only counts/hashes reach telemetry; never provider prompts, credentials or pixels. */
async function recordNativeImages(body: unknown): Promise<Set<string>> {
  const images: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      if (value.startsWith('data:image/')) images.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      if (
        'type' in value &&
        value.type === 'base64' &&
        'data' in value &&
        typeof value.data === 'string'
      )
        images.push(value.data);
      else Object.values(value).forEach(walk);
    }
  };
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return new Set();
    }
  }
  walk(parsed);
  return Telemetry.span('canvas.ai.model_images', async (span) => {
    span.setAttr('canvas.model.native_images', images.length);
    const hashes = await Promise.all(images.map(canvasImageIdentity));
    if (hashes.length)
      span.setAttr('canvas.model.image_sha256', hashes.join(','));
    return new Set(hashes);
  });
}

async function recordCanvasUsage(model: string, usage: LanguageModelUsage) {
  await Telemetry.span('canvas.ai.model_usage', async (span) => {
    span.setAttr('gen_ai.response.model', model);
    span.setAttr('gen_ai.usage.input_tokens', usage.inputTokens ?? 0);
    span.setAttr('gen_ai.usage.output_tokens', usage.outputTokens ?? 0);
  });
}

export async function editCanvas(
  source: CanvasSource,
  instructions: string,
  model: LanguageModel,
  signal: AbortSignal,
  editorName = 'Macro',
  options: CanvasAgentOptions = {}
) {
  const uncertainWrite = new AbortController();
  const editSignal = AbortSignal.any([signal, uncertainWrite.signal]);
  let operationsApplied = 0;
  let operationReservations = 0;
  let renders = 0;
  let dispatches = 0;
  const imagesForReview: (Pick<CanvasRender, 'revision' | 'crop'> & {
    evidenceId: string;
    imageHash: string;
  })[] = [];
  const consumedReviews: { revision: string; crop: Bounds }[] = [];
  const reviewBounds = new Map<string, Bounds>();
  const consumeImages = async (body: unknown) => {
    const hashes = await recordNativeImages(body);
    if (!hashes.size) return;
    const serialized = typeof body === 'string' ? body : JSON.stringify(body);
    for (const image of imagesForReview)
      if (serialized?.includes(image.evidenceId) && hashes.has(image.imageHash))
        consumedReviews.push({ revision: image.revision, crop: image.crop });
  };
  let clarification: string | undefined;
  const writerGate = new PQueue({ concurrency: 2 });
  const pendingOperations = new Set<Promise<unknown>>();
  const tracker = new TokenTracker();
  try {
    return await withCanvasSession(
      source,
      editSignal,
      async (session) => {
        const render = async (
          renderOptions: z.infer<typeof canvasRenderOptions>
        ) => {
          if (!options.render)
            throw new Error('Canvas image rendering is not configured.');
          if (++renders > 6)
            throw new Error('Canvas visual read budget reached (6 images).');
          const image = await options.render(
            session.snapshot(),
            renderOptions,
            editSignal
          );
          const evidenceId = crypto.randomUUID();
          imagesForReview.push({
            revision: image.revision,
            crop: image.crop,
            evidenceId,
            imageHash: await canvasImageIdentity(image.modelMedia[0].data),
          });
          return { ...image, evidenceId };
        };
        const writerTools = (
          present: (value: CanvasPresentation | undefined) => void
        ) => {
          let context = session.snapshot();
          return {
            readCanvas: tool({
              description:
                'Read the current merged scene. Overview is an approximate semantic graph with exact ID mapping; scene contains precise geometry.',
              inputSchema: z.object({
                itemIds: z.array(z.string().max(200)).max(100).optional(),
                format: z.enum(['scene', 'overview']).optional(),
              }),
              execute: async ({ itemIds, format }) => {
                context = session.snapshot();
                return format === 'overview'
                  ? JSON.stringify(canvasOverview(context.document, itemIds))
                  : describeCanvas(context.document, itemIds);
              },
            }),
            renderCanvas: tool({
              description:
                'See an actual read-only PNG of a frozen current scene, with revision, crop/world bounds and stable IDs. Use before visual/layout work and again to review it. Select itemIds or request a crop. Embedded resources may be explicitly unavailable.',
              inputSchema: canvasRenderOptions,
              execute: async (input) => {
                context = session.snapshot();
                return render(input);
              },
              toModelOutput: ({ output }) => canvasModelOutput(output),
            }),
            runCode: tool({
              description:
                'Run bounded JavaScript with editor. The batch validates, previews transiently, checks current dependencies, then commits once and waits for storage ACK. A conflict commits nothing from this batch: reread and replan. Never repeat a successful create.',
              inputSchema: z.object({ code: z.string().max(50_000) }),
              execute: ({ code }) => {
                const work = (async () => {
                  editSignal.throwIfAborted();
                  const baseline = context.document;
                  const ops = await Telemetry.span(
                    'canvas.ai.sandbox',
                    async () => runCanvasInSandbox(code)
                  );
                  if (operationReservations + ops.length > 200)
                    throw new Error(
                      'Canvas request operation budget reached (200).'
                    );
                  operationReservations += ops.length;
                  try {
                    const outcome = await session.apply(ops, {
                      baseline,
                      present,
                      measure: options.measure,
                    });
                    operationsApplied += outcome.operationsApplied;
                    context = session.snapshot();
                    const deps = dependencies(baseline, context.document, ops);
                    for (const id of new Set([...deps.reads, ...deps.writes])) {
                      const item = context.document.items[id];
                      if (item && item.type !== 'surface')
                        reviewBounds.set(id, worldBounds(context.document, id));
                      else reviewBounds.delete(id);
                    }
                    return outcome;
                  } catch (error) {
                    if (error instanceof CanvasWriteError)
                      uncertainWrite.abort(error);
                    throw error;
                  }
                })();
                pendingOperations.add(work);
                void work
                  .finally(() => pendingOperations.delete(work))
                  .catch(() => {});
                return work;
              },
            }),
            reportBlocked: tool({
              description:
                'Explain missing information or unsupported capabilities.',
              inputSchema: z.object({ message: z.string().max(2000) }),
              execute: async ({ message }) => {
                clarification = message;
                return message;
              },
            }),
          };
        };
        const runWriter = (task: string, index: number) =>
          writerGate.add(
            async () => {
              editSignal.throwIfAborted();
              const run = async (
                present: (value: CanvasPresentation | undefined) => void
              ) => {
                const result = await Telemetry.span(
                  'canvas.ai.model',
                  async () =>
                    generateText({
                      model,
                      system: `${SYSTEM}\nYou are writer ${index}. Complete only your delegated task. Do not dispatch additional writers.`,
                      prompt: `Task: ${task}\n\n<canvas-data>${session.read()}</canvas-data>`,
                      tools: writerTools(present),
                      abortSignal: editSignal,
                      maxOutputTokens: 3000,
                      stopWhen: [stepCountIs(4), hasToolCall('reportBlocked')],
                      onStepFinish: async (step) => {
                        tracker.add(
                          { modelId: step.response.modelId },
                          step.usage
                        );
                        await recordNativeImages(step.request.body);
                        await recordCanvasUsage(
                          step.response.modelId,
                          step.usage
                        );
                      },
                    })
                );
                return {
                  writer: index,
                  summary: result.text,
                  canvas: session.read(undefined, 'overview'),
                };
              };
              if (!options.createSource) return await run(session.present);
              return await withCanvasSession(
                options.createSource(),
                editSignal,
                async (writer) => run(writer.present),
                `${editorName} · Writer ${index}`
              );
            },
            { signal: editSignal }
          );
        const tools = {
          ...writerTools(session.present),
          dispatchEdits: tool({
            description:
              'Delegate up to two independent editing tasks to concurrent writers, for example distinct existing targets or well-separated layout regions. Planning and independent previews run in parallel. Actual command dependencies and occupied regions coordinate commits; conflicting stale batches reread/replan. Use one task for coupled changes, and never delegate the same intent twice.',
            inputSchema: z.object({
              tasks: z.array(z.string().min(1).max(4000)).min(1).max(2),
            }),
            execute: async ({ tasks }) => {
              if (++dispatches > 2)
                throw new Error(
                  'Canvas dispatch budget reached (2 dispatches, at most 4 writers).'
                );
              const results = await Promise.allSettled(
                tasks.map((task, index) =>
                  runWriter(task, (dispatches - 1) * 2 + index + 1)
                )
              );
              return results.map((result) =>
                result.status === 'fulfilled'
                  ? result.value
                  : {
                      error:
                        result.reason instanceof Error
                          ? result.reason.message
                          : 'Writer stopped. ReadCanvas before retrying.',
                    }
              );
            },
          }),
        };
        try {
          const initialScene = session.read();
          const initialImage = options.render ? await render({}) : undefined;
          const result = await Telemetry.span('canvas.ai.model', async () =>
            generateText({
              model,
              system: SYSTEM,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `Request: ${instructions}\n\n<canvas-data>${initialScene}</canvas-data>${initialImage ? `\nCurrent image already supplied; do not render it again before editing. Image metadata: ${JSON.stringify({ ...initialImage, modelMedia: undefined })}` : ''}`,
                    },
                    ...(initialImage?.modelMedia ?? []).map((image) => ({
                      type: 'image' as const,
                      image: image.data,
                      mediaType: image.mediaType,
                    })),
                  ],
                },
              ],
              tools,
              abortSignal: editSignal,
              maxOutputTokens: 3000,
              stopWhen: [stepCountIs(6), hasToolCall('reportBlocked')],
              onStepFinish: async (step) => {
                tracker.add({ modelId: step.response.modelId }, step.usage);
                await consumeImages(step.request.body);
                await recordCanvasUsage(step.response.modelId, step.usage);
              },
            })
          );
          let summary = result.text;
          const finalRevision = await canvasRevision(session.snapshot());
          const reviewed = [...reviewBounds.values()].every((bounds) =>
            consumedReviews.some(
              ({ revision, crop }) =>
                revision === finalRevision &&
                bounds.x >= crop.x &&
                bounds.y >= crop.y &&
                bounds.x + bounds.width <= crop.x + crop.width &&
                bounds.y + bounds.height <= crop.y + crop.height
            )
          );
          if (operationsApplied && options.render && !reviewed) {
            const image = await render({});
            const { modelMedia, ...metadata } = image;
            const review = await Telemetry.span(
              'canvas.ai.correction',
              async () =>
                generateText({
                  model,
                  system: `${SYSTEM}\nReview the resulting image. Correct only concrete mistakes in the requested layout. Do not recreate successful items. If it already meets the request, report success without editing. This is the final bounded correction pass.`,
                  messages: [
                    {
                      role: 'user',
                      content: `Original request: ${instructions}\nStarting scene before acknowledged edits: <canvas-data>${initialScene}</canvas-data>`,
                    },
                    ...result.response.messages,
                    {
                      role: 'user',
                      content: [
                        {
                          type: 'text',
                          text: `Continue reviewing the ALREADY COMMITTED tool history above. Successful calls must not be repeated, including relative moves. Compare against the starting scene and repair only a concrete remaining mismatch. Original request: ${instructions}\nCurrent scene: ${session.read()}\nImage metadata: ${JSON.stringify(metadata)}`,
                        },
                        ...modelMedia.map((image) => ({
                          type: 'image' as const,
                          image: image.data,
                          mediaType: image.mediaType,
                        })),
                      ],
                    },
                  ],
                  tools: writerTools(session.present),
                  abortSignal: editSignal,
                  maxOutputTokens: 2000,
                  stopWhen: [stepCountIs(3), hasToolCall('reportBlocked')],
                  onStepFinish: async (step) => {
                    tracker.add({ modelId: step.response.modelId }, step.usage);
                    await consumeImages(step.request.body);
                    await recordCanvasUsage(step.response.modelId, step.usage);
                  },
                })
            );
            summary = `${summary || `Applied ${operationsApplied} acknowledged Canvas operations.`}\n\nVisual review: ${review.text || 'Complete.'}`;
          }
          if (!operationsApplied && !clarification)
            throw new Error('No Canvas edits were applied.');
          return {
            operationsApplied,
            summary:
              summary ||
              `Applied ${operationsApplied} acknowledged canvas operations.`,
            clarification,
            usage: tracker.toEntries(),
          };
        } finally {
          await writerGate.onIdle();
          await Promise.allSettled([...pendingOperations]);
        }
      },
      editorName
    );
  } catch (error) {
    return {
      operationsApplied,
      summary: `Stopped after ${operationsApplied} acknowledged canvas operations.`,
      usage: tracker.toEntries(),
      error:
        error instanceof Error
          ? error.message
          : 'Canvas editing failed. Read the canvas before retrying.',
    };
  }
}
