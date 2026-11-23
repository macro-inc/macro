/** One span from an OTLP/HTTP JSON trace export, flattened for analysis. */
export type CapturedSpan = {
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  name: string;
  /** Epoch milliseconds. */
  start: number;
  /** Epoch milliseconds. */
  end: number;
  attributes: Record<string, string | number | boolean>;
  resource: Record<string, string | number | boolean>;
};

type OtlpValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
};

type OtlpAttribute = { key: string; value?: OtlpValue };

type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string | number;
  endTimeUnixNano: string | number;
  attributes?: OtlpAttribute[];
};

type OtlpExport = {
  resourceSpans?: {
    resource?: { attributes?: OtlpAttribute[] };
    scopeSpans?: { spans?: OtlpSpan[] }[];
  }[];
};

function value(attribute: OtlpValue | undefined): string | number | boolean {
  if (!attribute) return '';
  if (attribute.stringValue !== undefined) return attribute.stringValue;
  if (attribute.intValue !== undefined) return Number(attribute.intValue);
  if (attribute.doubleValue !== undefined) return attribute.doubleValue;
  if (attribute.boolValue !== undefined) return attribute.boolValue;
  return '';
}

function attributes(list: OtlpAttribute[] | undefined) {
  return Object.fromEntries(
    (list ?? []).map((entry) => [entry.key, value(entry.value)])
  );
}

/** Nanoseconds as a decimal string, to epoch milliseconds. */
function millis(nanos: string | number): number {
  return Number(BigInt(nanos) / 1000n) / 1000;
}

/** Flattens one OTLP/HTTP JSON trace export body. */
export function parseOtlpTraces(body: string): CapturedSpan[] {
  const parsed = JSON.parse(body) as OtlpExport;
  return (parsed.resourceSpans ?? []).flatMap((resourceSpan) => {
    const resource = attributes(resourceSpan.resource?.attributes);
    return (resourceSpan.scopeSpans ?? []).flatMap((scope) =>
      (scope.spans ?? []).map((span) => ({
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId || undefined,
        name: span.name,
        start: millis(span.startTimeUnixNano),
        end: millis(span.endTimeUnixNano),
        attributes: attributes(span.attributes),
        resource,
      }))
    );
  });
}
