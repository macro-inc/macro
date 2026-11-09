import { ThrownResultError } from '@core/util/result';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserExecutionReceipt } from '../queries/document-programs';
import { attachProgramHost, MAX_IN_FLIGHT_RUNS } from './preview-runner';

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (
      _name: string,
      operation: (span: { setAttr: () => void; error: () => void }) => unknown
    ) => operation({ setAttr: () => {}, error: () => {} }),
  },
}));

type Posted = { message: unknown; origin: string };

/**
 * A real (jsdom) frame whose window records what the host posts to it, and
 * which can message the host as that window.
 */
function fakeFrame() {
  const posted: Posted[] = [];
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const contentWindow = frame.contentWindow;
  if (!contentWindow) throw new Error('jsdom gave the frame no window');
  vi.spyOn(contentWindow, 'postMessage').mockImplementation(
    (message: unknown, origin?: unknown) => {
      posted.push({ message, origin: String(origin) });
    }
  );
  const send = (data: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', { data, source: contentWindow })
    );
  return { frame, posted, send };
}

/** A run that returned `value`, wrapped as the runtime reports it. */
const succeeded = (value: unknown): UserExecutionReceipt => ({
  status: 'succeeded',
  activity: [],
  activityTruncated: false,
  result: { data: value },
});

const options = (
  run: Parameters<typeof attachProgramHost>[1]['run'],
  onStale = () => {}
) => ({ documentId: 'doc', sourceHash: 'hash', token: 't', run, onStale });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('attachProgramHost', () => {
  const detachers: Array<() => void> = [];
  afterEach(() => {
    for (const detach of detachers.splice(0)) detach();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('runs the program and posts its result back', async () => {
    const { frame, posted, send } = fakeFrame();
    const run = vi.fn(async () => succeeded({ count: 2 }));
    detachers.push(attachProgramHost(frame, options(run)));

    send({
      type: 'macro:run',
      token: 't',
      id: 1,
      program: 'tasks',
      arguments: { a: 1 },
    });
    await flush();

    expect(run).toHaveBeenCalledWith(
      'doc',
      { sourceHash: 'hash', program: 'tasks', arguments: { a: 1 } },
      expect.any(AbortSignal)
    );
    expect(posted).toEqual([
      {
        message: {
          type: 'macro:result',
          token: 't',
          id: 1,
          result: { count: 2 },
        },
        origin: '*',
      },
    ]);
  });

  it('turns a failed receipt into an error reply', async () => {
    const { frame, posted, send } = fakeFrame();
    const run = vi.fn(
      async (): Promise<UserExecutionReceipt> => ({
        status: 'failed',
        activity: [],
        activityTruncated: false,
        error: 'main must return JSON',
      })
    );
    detachers.push(attachProgramHost(frame, options(run)));

    send({ type: 'macro:run', token: 't', id: 7, program: 'tasks' });
    await flush();

    expect(posted[0]?.message).toEqual({
      type: 'macro:error',
      token: 't',
      id: 7,
      message: 'main must return JSON',
    });
  });

  it('ignores messages without the token or from another window', async () => {
    const { frame, posted, send } = fakeFrame();
    const run = vi.fn(async () => succeeded(null));
    detachers.push(attachProgramHost(frame, options(run)));

    send({ type: 'macro:run', token: 'other', id: 1, program: 'tasks' });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'macro:run', token: 't', id: 1, program: 'tasks' },
        source: window,
      })
    );
    await flush();

    expect(run).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it('refuses a run beyond the in-flight cap before the server', async () => {
    const { frame, posted, send } = fakeFrame();
    let release: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<UserExecutionReceipt>((resolve) => {
          release = () => resolve(succeeded(1));
        })
    );
    detachers.push(attachProgramHost(frame, options(run)));

    for (let id = 1; id <= MAX_IN_FLIGHT_RUNS + 1; id += 1)
      send({ type: 'macro:run', token: 't', id, program: 'tasks' });
    await flush();

    expect(run).toHaveBeenCalledTimes(MAX_IN_FLIGHT_RUNS);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.message).toMatchObject({
      type: 'macro:error',
      id: MAX_IN_FLIGHT_RUNS + 1,
    });
    release?.();
  });

  it('asks for a fresh build when the document changed', async () => {
    const { frame, posted, send } = fakeFrame();
    const onStale = vi.fn();
    const run = vi.fn(async (): Promise<UserExecutionReceipt> => {
      throw new ThrownResultError([
        { code: 'DOCUMENT_CHANGED', message: 'This page changed.' },
      ]);
    });
    detachers.push(attachProgramHost(frame, options(run, onStale)));

    send({ type: 'macro:run', token: 't', id: 1, program: 'tasks' });
    await flush();

    expect(onStale).toHaveBeenCalledTimes(1);
    expect(posted[0]?.message).toMatchObject({ type: 'macro:error', id: 1 });
  });

  it('stops answering once detached', async () => {
    const { frame, posted, send } = fakeFrame();
    const run = vi.fn(async () => succeeded(1));
    const detach = attachProgramHost(frame, options(run));
    detach();

    send({ type: 'macro:run', token: 't', id: 1, program: 'tasks' });
    await flush();

    expect(run).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});
