import { readLoroGraphicsDocument } from '@macro-inc/graphics/loro';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { canvasRevision } from './revision';
import { liveScene } from './test-fixtures';

// The production runner's worker-only WASM module is replaced with Node's
// build of the same QuickJS engine; command validation and execution are real.
vi.mock('../sandbox', async () => {
  const { getQuickJS } = await import('quickjs-emscripten');
  const { runCanvasCode } = await import('./sandbox');
  return {
    runCanvasInSandbox: async (code: string) =>
      runCanvasCode(await getQuickJS(), code),
  };
});
const { editCanvas } = await import('./agent');

describe('Canvas model loop', () => {
  it('passes requested tool images and final review images as native model content', async () => {
    const scene = liveScene();
    let step = 0;
    let toolImage = false,
      reviewImage = false;
    const model = new MockLanguageModelV3({
      modelId: 'vision-fixture',
      doGenerate: async ({ prompt }) => {
        const current = step++;
        if (current === 1)
          toolImage = prompt.some(
            (message) =>
              message.role === 'tool' &&
              message.content.some(
                (part) =>
                  part.type === 'tool-result' &&
                  part.output.type === 'content' &&
                  part.output.value.some((value) => value.type === 'image-data')
              )
          );
        if (current === 3)
          reviewImage = prompt.some(
            (message) =>
              message.role === 'user' &&
              message.content.some(
                (part) => part.type === 'file' && part.mediaType === 'image/png'
              )
          );
        return {
          content:
            current === 0
              ? [
                  {
                    type: 'tool-call',
                    toolCallId: 'render-1',
                    toolName: 'renderCanvas',
                    input: '{}',
                  },
                ]
              : current === 1
                ? [
                    {
                      type: 'tool-call',
                      toolCallId: 'create-1',
                      toolName: 'runCode',
                      input: JSON.stringify({
                        code: 'editor.create({type:"rectangle",x:0,y:0,width:100,height:80})',
                      }),
                    },
                  ]
                : [{ type: 'text', text: 'Complete.' }],
          finishReason: {
            unified: current < 2 ? 'tool-calls' : 'stop',
            raw: undefined,
          },
          usage: {
            inputTokens: {
              total: 10,
              noCache: 10,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    try {
      const result = await editCanvas(
        scene.source,
        'Add one box',
        model,
        new AbortController().signal,
        'Macro',
        {
          render: async () => ({
            revision: 'frozen',
            clock: {},
            crop: { x: 0, y: 0, width: 100, height: 100 },
            width: 100,
            height: 100,
            objects: [],
            unavailable: [],
            textLayout: [],
            modelMedia: [
              { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
            ],
          }),
        }
      );
      expect(result.operationsApplied).toBe(1);
      expect(toolImage).toBe(true);
      expect(reviewImage).toBe(true);
    } finally {
      scene.server.free();
    }
  });

  it('does not force another model/render review of an already reviewed final revision', async () => {
    const scene = liveScene();
    let calls = 0,
      images = 0;
    const model = new MockLanguageModelV3({
      modelId: 'review-once',
      doGenerate: async ({ prompt }) => {
        const step = calls++;
        if (step > 2) throw new Error('Duplicate review model call');
        return {
          request: {
            body: JSON.stringify({
              prompt,
              image: 'data:image/png;base64,iVBORw0KGgo=',
            }),
          },
          content:
            step === 0
              ? [
                  {
                    type: 'tool-call',
                    toolCallId: 'create',
                    toolName: 'runCode',
                    input: JSON.stringify({
                      code: 'editor.create({type:"rectangle",x:0,y:0,width:100,height:80})',
                    }),
                  },
                ]
              : step === 1
                ? [
                    {
                      type: 'tool-call',
                      toolCallId: 'review',
                      toolName: 'renderCanvas',
                      input: '{}',
                    },
                  ]
                : [{ type: 'text', text: 'Reviewed the final layout.' }],
          finishReason: {
            unified: step < 2 ? 'tool-calls' : 'stop',
            raw: undefined,
          },
          usage: {
            inputTokens: {
              total: 10,
              noCache: 10,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    try {
      const result = await editCanvas(
        scene.source,
        'Design a diagram',
        model,
        new AbortController().signal,
        'Macro',
        {
          render: async (snapshot) => {
            images++;
            return {
              revision: await canvasRevision(snapshot),
              clock: snapshot.clock,
              crop: { x: -32, y: -32, width: 164, height: 144 },
              width: 328,
              height: 288,
              objects: [],
              unavailable: [],
              textLayout: [],
              modelMedia: [
                { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
              ],
            };
          },
        }
      );
      expect(result.operationsApplied).toBe(1);
      expect(calls).toBe(3);
      expect(images).toBe(2);
    } finally {
      scene.server.free();
    }
  });

  it.each(['last-step', 'partial-crop', 'same-revision-crops'])(
    'requires consumed, covering review evidence: %s',
    async (mode) => {
      const scene = liveScene();
      let calls = 0,
        images = 0;
      const model = new MockLanguageModelV3({
        modelId: 'review-evidence',
        doGenerate: async ({ prompt }) => {
          const step = calls++;
          const renderStep = mode === 'partial-crop' ? 1 : 5;
          if (mode === 'partial-crop' && step === 3) {
            // A correction is a continuation: losing acknowledged tool history
            // made a real model repeat a successful relative move.
            expect(
              prompt.some(
                (message) =>
                  message.role === 'assistant' &&
                  message.content.some(
                    (part) =>
                      part.type === 'tool-call' && part.toolName === 'runCode'
                  )
              )
            ).toBe(true);
          }

          const call =
            step === 0
              ? {
                  toolName: 'runCode',
                  input: JSON.stringify({
                    code: 'editor.create({type:"rectangle",x:500,y:500,width:100,height:80})',
                  }),
                }
              : step === renderStep ||
                  (mode === 'same-revision-crops' && step === 1)
                ? {
                    toolName: 'renderCanvas',
                    input:
                      mode === 'partial-crop' ||
                      (mode === 'same-revision-crops' && step === 1)
                        ? JSON.stringify({
                            crop: { x: 0, y: 0, width: 10, height: 10 },
                          })
                        : '{}',
                  }
                : step < renderStep
                  ? { toolName: 'readCanvas', input: '{}' }
                  : undefined;
          return {
            request: {
              body: JSON.stringify({
                prompt,
                image: 'data:image/png;base64,iVBORw0KGgo=',
              }),
            },
            content: call
              ? [{ type: 'tool-call', toolCallId: `step-${step}`, ...call }]
              : [{ type: 'text', text: 'Done.' }],
            finishReason: {
              unified: call ? 'tool-calls' : 'stop',
              raw: undefined,
            },
            usage: {
              inputTokens: {
                total: 10,
                noCache: 10,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 5, text: 5, reasoning: undefined },
            },
            warnings: [],
          };
        },
      });
      try {
        const result = await editCanvas(
          scene.source,
          'Design a box',
          model,
          new AbortController().signal,
          'Macro',
          {
            render: async (snapshot, options) => {
              images++;
              return {
                revision: await canvasRevision(snapshot),
                clock: snapshot.clock,
                crop: options?.crop ?? {
                  x: 0,
                  y: 0,
                  width: 1000,
                  height: 1000,
                },
                width: 100,
                height: 100,
                objects: [],
                unavailable: [],
                textLayout: [],
                modelMedia: [
                  {
                    type: 'image',
                    mediaType: 'image/png',
                    data: 'iVBORw0KGgo=',
                  },
                ],
              };
            },
          }
        );
        expect(result.operationsApplied).toBe(1);
        expect(calls).toBe(mode === 'partial-crop' ? 4 : 7);
        expect(images).toBe(mode === 'same-revision-crops' ? 4 : 3);
      } finally {
        scene.server.free();
      }
    }
  );

  it('retains acknowledged edits and completed usage when a later provider call fails', async () => {
    const scene = liveScene();
    let step = 0;
    const model = new MockLanguageModelV3({
      modelId: 'canvas-fixture',
      doGenerate: async () => {
        if (step++ > 0) throw new Error('Provider unavailable');
        return {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'create-1',
              toolName: 'runCode',
              input: JSON.stringify({
                code: 'editor.create({type:"rectangle",x:0,y:0,width:100,height:50,text:"Keep me"})',
              }),
            },
          ],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: {
            inputTokens: {
              total: 10,
              noCache: 10,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    try {
      const result = await editCanvas(
        scene.source,
        'Make a diagram',
        model,
        new AbortController().signal
      );
      expect(result).toMatchObject({
        operationsApplied: 1,
        error: 'Provider unavailable',
        usage: [{ model: 'canvas-fixture', inputTokens: 10, outputTokens: 5 }],
      });
      expect(
        Object.keys(readLoroGraphicsDocument(scene.server, 'scene-root').items)
      ).toHaveLength(2);
      expect(scene.closed()).toBe(true);
    } finally {
      scene.server.free();
    }
  });
});
