import { Telemetry } from '@macro-inc/observability';
import { ResultAsync } from 'neverthrow';

type Attributes = Record<string, string | number | boolean>;

/**
 * Run one packet operation inside a span named for it. The span carries the
 * ids and counts given, never names, addresses, or document text, and is
 * marked failed with the kind of error the operation returned.
 */
export function traced<T, E extends { kind: string }>(
  name: string,
  attributes: Attributes,
  work: () => ResultAsync<T, E>
): ResultAsync<T, E> {
  return new ResultAsync(
    Telemetry.span(name, async (span) => {
      for (const [key, attribute] of Object.entries(attributes)) {
        span.setAttr(key, attribute);
      }
      const result = await work();
      if (result.isErr()) {
        span.setAttr('error.kind', result.error.kind);
        span.error(result.error.kind);
      }
      return result;
    })
  );
}
