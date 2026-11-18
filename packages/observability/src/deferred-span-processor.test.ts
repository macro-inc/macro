import { ROOT_CONTEXT } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { expect, test, vi } from 'vitest';
import { DeferredSpanProcessor } from './deferred-span-processor';

test('retains early parentage but exports nothing until enabled', async () => {
  let decide: (allowed: boolean) => void = () => {};
  const decision = new Promise<boolean>((resolve) => {
    decide = resolve;
  });
  const exporter = new InMemorySpanExporter();
  const create = vi.fn(() => new SimpleSpanProcessor(exporter));
  const processor = new DeferredSpanProcessor(decision, create);
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  const root = provider
    .getTracer('test')
    .startSpan('app.boot', {}, ROOT_CONTEXT);
  root.end();
  expect(create).not.toHaveBeenCalled();
  expect(exporter.getFinishedSpans()).toHaveLength(0);
  decide(true);
  await processor.forceFlush();
  expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
    'app.boot',
  ]);
  await provider.shutdown();
});

test.each(['denied', 'failed', 'shutdown'] as const)(
  'drops early spans when %s',
  async (outcome) => {
    let decide: (allowed: boolean) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const decision = new Promise<boolean>((resolve, fail) => {
      decide = resolve;
      reject = fail;
    });
    const create = vi.fn(
      () => new SimpleSpanProcessor(new InMemorySpanExporter())
    );
    const processor = new DeferredSpanProcessor(decision, create);
    const provider = new BasicTracerProvider({ spanProcessors: [processor] });
    provider.getTracer('test').startSpan('early').end();
    if (outcome === 'shutdown') await processor.shutdown();
    if (outcome === 'failed') reject(new Error('unavailable'));
    else decide(outcome === 'shutdown');
    await processor.forceFlush();
    provider.getTracer('test').startSpan('late').end();
    expect(create).not.toHaveBeenCalled();
    await provider.shutdown();
  }
);

test('shuts down a processor whose asynchronous creation completes after disposal', async () => {
  let finish: (processor: SimpleSpanProcessor) => void = () => {};
  let started: () => void = () => {};
  const creating = new Promise<void>((resolve) => {
    started = resolve;
  });
  const exporter = new InMemorySpanExporter();
  const inner = new SimpleSpanProcessor(exporter);
  const shutdown = vi.spyOn(inner, 'shutdown');
  const processor = new DeferredSpanProcessor(Promise.resolve(true), () => {
    started();
    return new Promise<SimpleSpanProcessor>((resolve) => {
      finish = resolve;
    });
  });
  await creating;
  await processor.shutdown();
  finish(inner);
  await processor.forceFlush();
  expect(shutdown).toHaveBeenCalledOnce();
  expect(exporter.getFinishedSpans()).toHaveLength(0);
});
