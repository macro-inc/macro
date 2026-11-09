import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentProgramReceipt } from '../queries/document-programs';
import { MAX_IN_FLIGHT_RUNS, attachProgramHost } from './preview-runner';

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

const succeeded = (result: unknown): DocumentProgramReceipt => ({
  status: 'succeeded',
  activity: [],
  activityTruncated: false,
  result,
});

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
    detachers.push(
      attachProgramHost(frame, { documentId: 'doc', token: 't', run })
    );

    send({
      type: 'macro:run',
      token: 't',
      id: 1,
      source: 'src',
      arguments: { a: 1 },
    });
    await flush();

    expect(run).toHaveBeenCalledWith(
      'doc',
      { source: 'src', arguments: { a: 1 } },
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
      async (): Promise<DocumentProgramReceipt> => ({
        status: 'failed',
        activity: [],
        activityTruncated: false,
        error: 'main must return JSON',
      })
    );
    detachers.push(
      attachProgramHost(frame, { documentId: 'doc', token: 't', run })
    );

    send({ type: 'macro:run', token: 't', id: 7, source: 'src' });
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
    detachers.push(
      attachProgramHost(frame, { documentId: 'doc', token: 't', run })
    );

    send({ type: 'macro:run', token: 'other', id: 1, source: 'src' });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'macro:run', token: 't', id: 1, source: 'src' },
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
        new Promise<DocumentProgramReceipt>((resolve) => {
          release = () => resolve(succeeded(1));
        })
    );
    detachers.push(
      attachProgramHost(frame, { documentId: 'doc', token: 't', run })
    );

    for (let id = 1; id <= MAX_IN_FLIGHT_RUNS + 1; id += 1)
      send({ type: 'macro:run', token: 't', id, source: 'src' });
    await flush();

    expect(run).toHaveBeenCalledTimes(MAX_IN_FLIGHT_RUNS);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.message).toMatchObject({
      type: 'macro:error',
      id: MAX_IN_FLIGHT_RUNS + 1,
    });
    release?.();
  });

  it('stops answering once detached', async () => {
    const { frame, posted, send } = fakeFrame();
    const run = vi.fn(async () => succeeded(1));
    const detach = attachProgramHost(frame, {
      documentId: 'doc',
      token: 't',
      run,
    });
    detach();

    send({ type: 'macro:run', token: 't', id: 1, source: 'src' });
    await flush();

    expect(run).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});
