import type { Span } from './span';

class NoopSpan implements Span {
  span<T>(name: string, operation: (span: Span) => Promise<T>): Promise<T>;
  span(name: string): Span;
  span<T>(
    _name: string,
    operation?: (span: Span) => Promise<T>
  ): Span | Promise<T> {
    return operation ? operation(this) : this;
  }

  run<T>(operation: () => T): T {
    return operation();
  }

  setAttr(): void {}
  event(): void {}
  error(): void {}
  traceparent(): undefined {}
  injectTraceHeaders(): void {}
  end(): void {}
}

/** A span that records nothing, for code that runs outside any trace. */
export const NOOP_SPAN: Span = new NoopSpan();
