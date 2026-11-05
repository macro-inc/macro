import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { assertEquals } from '@std/assert';
import { relayTelemetry, stdioExporter } from './telemetry-relay.ts';

Deno.test('stdio telemetry preserves span identity and survives malformed child output', async () => {
  const lines: string[] = [];
  const log = console.log;
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(stdioExporter)],
  });
  const span = provider.getTracer('test').startSpan('brain.turn');
  const context = span.spanContext();
  console.log = (line: string) => {
    lines.push(line);
  };
  try {
    span.end();
    await provider.forceFlush();
  } finally {
    console.log = log;
  }
  const collector = new InMemorySpanExporter();
  const received = collector.getFinishedSpans.bind(collector);
  // InMemorySpanExporter resets on shutdown; retain the result first.
  let forwarded = 0;
  await relayTelemetry(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `brain-telemetry:broken\n${lines.join('\n')}\n`
          )
        );
        controller.close();
      },
    }),
    undefined,
    {
      export(spans, done) {
        collector.export(spans, done);
        forwarded += spans.length;
        assertEquals(received()[0]?.spanContext(), context);
      },
      shutdown: async () => {},
    }
  );
  assertEquals(forwarded, 1);
  await provider.shutdown();
});
