// Keep the collector outside the workspace process's network capabilities.
import type { SpanContext } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

const PREFIX = 'brain-telemetry:';
type WireSpan = Omit<ReadableSpan, 'spanContext' | 'resource'> & {
  context: SpanContext;
  resource: ReadableSpan['resource']['attributes'];
};

export const stdioExporter: SpanExporter = {
  export(spans, done) {
    for (const span of spans) {
      const wire: WireSpan = {
        name: span.name,
        kind: span.kind,
        parentSpanContext: span.parentSpanContext,
        startTime: span.startTime,
        endTime: span.endTime,
        status: span.status,
        attributes: span.attributes,
        links: span.links,
        events: span.events,
        duration: span.duration,
        ended: span.ended,
        droppedAttributesCount: span.droppedAttributesCount,
        droppedEventsCount: span.droppedEventsCount,
        droppedLinksCount: span.droppedLinksCount,
        instrumentationScope: span.instrumentationScope,
        context: span.spanContext(),
        resource: span.resource.attributes,
      };
      console.log(PREFIX + JSON.stringify(wire));
    }
    done({ code: ExportResultCode.SUCCESS });
  },
  shutdown: async () => {},
};

/** Forward child spans without granting it collector net access or credentials. */
export async function relayTelemetry(
  stream: ReadableStream<Uint8Array>,
  endpoint: string | undefined,
  sink?: SpanExporter
): Promise<void> {
  const exporter =
    sink ?? (endpoint ? new OTLPTraceExporter({ url: endpoint }) : undefined);
  let buffer = '';

  try {
    for await (const text of stream.pipeThrough(new TextDecoderStream())) {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      if (buffer.length > 1_000_000) buffer = '';
      for (const line of lines) {
        if (!line.startsWith(PREFIX)) {
          console.log(line);
          continue;
        }
        if (!exporter) continue;
        try {
          const wire: WireSpan = JSON.parse(line.slice(PREFIX.length));
          const span: ReadableSpan = {
            ...wire,
            spanContext: () => wire.context,
            resource: resourceFromAttributes(wire.resource),
          };
          await new Promise<void>((resolve) =>
            exporter.export([span], () => resolve())
          );
        } catch {
          console.error(JSON.stringify({ telemetry: 'invalid_child_span' }));
        }
      }
    }
  } finally {
    await exporter
      ?.shutdown()
      .catch(() =>
        console.error(JSON.stringify({ telemetry: 'export_failed' }))
      );
  }
}
