import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const operations = vi.hoisted(
  () =>
    [] as {
      name: string;
      options: { event?: Event; attributes?: Record<string, unknown> };
      attributes: Record<string, unknown>;
      afterPaint: ReturnType<typeof vi.fn>;
      finish: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
    }[]
);
vi.mock('../../../observability/ui-operation', () => ({
  startUiOperation: (
    name: string,
    options: { event?: Event; attributes?: Record<string, unknown> }
  ) => {
    const operation = {
      name,
      options,
      attributes: {} as Record<string, unknown>,
      afterPaint: vi.fn(),
      finish: vi.fn(),
      cancel: vi.fn(),
    };
    operations.push(operation);
    return {
      run: (work: () => unknown) => work(),
      mark: () => {},
      setAttributes: (attributes: Record<string, unknown>) =>
        Object.assign(operation.attributes, attributes),
      afterPaint: operation.afterPaint,
      finish: operation.finish,
      cancel: operation.cancel,
    };
  },
}));

import { createThreadOpenTracker } from './thread-open';

const shown = (messageId: string, source: 'memory' | 'parsed' | 'direct') => ({
  messageId,
  path: 'cache' as const,
  source,
  prepareMs: 4,
  mountMs: 2,
  totalMs: 6,
  htmlLength: 2048,
});

beforeEach(() => {
  operations.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it('finishes after the thread is ready and every pending body has shown', () => {
  const opens = createThreadOpenTracker({
    arm: () => 'test',
    enabled: () => true,
  });
  opens.start('thread-a');
  opens.observer.pending('m1');
  opens.observer.pending('m2');
  opens.ready();
  vi.runAllTimers();
  expect(operations[0].afterPaint).not.toHaveBeenCalled();
  opens.observer.shown(shown('m1', 'memory'));
  expect(operations[0].afterPaint).not.toHaveBeenCalled();
  opens.observer.shown(shown('m2', 'parsed'));
  expect(operations[0].afterPaint).toHaveBeenCalledOnce();
  expect(operations[0].options.attributes).toMatchObject({
    'email.render_cache.arm': 'test',
    'email.render_cache.enabled': true,
    'email.thread.repeat': false,
  });
  expect(operations[0].attributes).toMatchObject({
    'email.thread.bodies': 2,
    'email.thread.bodies_memory': 1,
    'email.thread.bodies_parsed': 1,
    'email.thread.html_kb': 4,
  });
});

it('counts bodies shown before the thread is ready, and finishes a thread without HTML bodies', () => {
  const opens = createThreadOpenTracker({
    arm: () => undefined,
    enabled: () => false,
  });
  opens.start('thread-a');
  // Main's body prepares and mounts during the render that shows the thread.
  opens.observer.pending('m1');
  opens.observer.shown(shown('m1', 'direct'));
  opens.ready();
  expect(operations[0].afterPaint).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(operations[0].afterPaint).toHaveBeenCalledOnce();
  expect(operations[0].options.attributes).toMatchObject({
    'email.render_cache.arm': 'none',
  });
  expect(operations[0].attributes).toMatchObject({
    'email.thread.bodies_direct': 1,
  });

  opens.start('thread-b');
  opens.ready();
  vi.runAllTimers();
  expect(operations[1].afterPaint).toHaveBeenCalledOnce();
  expect(operations[1].attributes).toMatchObject({ 'email.thread.bodies': 0 });
});

it('cancels an open superseded by another thread and ignores its late bodies', () => {
  const opens = createThreadOpenTracker({
    arm: () => 'control',
    enabled: () => false,
  });
  opens.start('thread-a');
  const release = opens.observer.pending('m1');
  opens.start('thread-b');
  expect(operations[0].cancel).toHaveBeenCalledOnce();
  release();
  opens.observer.shown(shown('m1', 'direct'));
  opens.ready();
  vi.runAllTimers();
  expect(operations[1].afterPaint).toHaveBeenCalledOnce();
  expect(operations[1].attributes).toMatchObject({ 'email.thread.bodies': 0 });
});

it('marks a thread reopened in the same page load, and records failures', () => {
  const opens = createThreadOpenTracker({
    arm: () => 'test',
    enabled: () => true,
  });
  opens.start('thread-repeat');
  opens.fail();
  expect(operations[0].finish).toHaveBeenCalledWith('error');
  opens.start('thread-repeat');
  expect(operations[1].options.attributes).toMatchObject({
    'email.thread.repeat': true,
  });
  opens.dispose();
  expect(operations[1].cancel).toHaveBeenCalledOnce();
});

it('lets a body that unmounts before showing release the open', () => {
  const opens = createThreadOpenTracker({
    arm: () => 'test',
    enabled: () => true,
  });
  opens.start('thread-a');
  const release = opens.observer.pending('m1');
  opens.ready();
  vi.runAllTimers();
  expect(operations[0].afterPaint).not.toHaveBeenCalled();
  release();
  expect(operations[0].afterPaint).toHaveBeenCalledOnce();
});
