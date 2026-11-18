import type { Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';

/** Keep early spans in memory; never construct an exporter before consent. */
export class DeferredSpanProcessor implements SpanProcessor {
  #pending: ReadableSpan[] = [];
  #processor: SpanProcessor | undefined;
  #closed = false;
  readonly #ready: Promise<void>;

  constructor(
    enabled: Promise<boolean>,
    create: () => SpanProcessor | Promise<SpanProcessor>
  ) {
    this.#ready = this.#initialize(enabled, create);
  }

  async #initialize(
    enabled: Promise<boolean>,
    create: () => SpanProcessor | Promise<SpanProcessor>
  ) {
    let allowed = false;
    try {
      allowed = await enabled;
      if (!this.#closed && allowed) {
        const processor = await create();
        if (this.#closed) await processor.shutdown();
        else {
          this.#processor = processor;
          for (const span of this.#pending) processor.onEnd(span);
        }
      }
    } catch {
      // Unavailable consent or startup settings must fail closed.
      allowed = false;
    }
    this.#pending = [];
    if (!allowed) this.#closed = true;
  }

  onStart(span: Span, parent: Context): void {
    this.#processor?.onStart(span, parent);
  }

  onEnd(span: ReadableSpan): void {
    if (this.#closed) return;
    if (this.#processor) this.#processor.onEnd(span);
    else if (this.#pending.length < 2048) this.#pending.push(span);
  }

  async forceFlush(): Promise<void> {
    await this.#ready;
    await this.#processor?.forceFlush();
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    this.#pending = [];
    await this.#processor?.shutdown();
  }
}
