import { type Span, Telemetry } from '@macro-inc/observability';
import { afterEach, expect, it, vi } from 'vitest';
import { createInputTelemetry } from './telemetry';

// Observe the facade boundary, without initializing a network exporter.
class RecordedSpan implements Span {
  attrs: Record<string, unknown> = {};
  events: { name: string; attrs: Record<string, unknown> }[] = [];
  ended = false;
  constructor(
    readonly name: string,
    readonly children: RecordedSpan[] = []
  ) {}
  span<T>(name: string, operation: (span: Span) => Promise<T>): Promise<T>;
  span(name: string): Span;
  span<T>(
    name: string,
    operation?: (span: Span) => Promise<T>
  ): Span | Promise<T> {
    const child = new RecordedSpan(name, this.children);
    this.children.push(child);
    return operation ? operation(child).finally(() => child.end()) : child;
  }
  run<T>(operation: () => T): T {
    return operation();
  }
  setAttr(name: string, value: unknown) {
    this.attrs[name] = value;
  }
  error(value: unknown) {
    this.attrs.error = value;
  }
  event(name: string, attrs: Record<string, unknown> = {}) {
    this.events.push({ name, attrs });
  }
  traceparent() {
    return undefined;
  }
  injectTraceHeaders() {}
  end() {
    this.ended = true;
  }
}
function setup() {
  const root = new RecordedSpan('universal_input.draft');
  vi.spyOn(Telemetry, 'span').mockReturnValue(root);
  const telemetry = createInputTelemetry('mobile-search');
  telemetry.observe({
    event: 'changed',
    draftId: 'opaque',
    revision: 1,
    length: 42,
    reason: 'text',
  });
  return { ...telemetry, root };
}
afterEach(() => vi.restoreAllMocks());

it('closes drafts and pending submissions on disposal and ignores late observations', () => {
  const telemetry = setup();
  telemetry.observe({
    event: 'prediction',
    draftId: 'opaque',
    phase: 'extract',
    revision: 1,
    outcome: 'started',
  });
  telemetry.observe({
    event: 'submission',
    draftId: 'opaque',
    intent: 'email',
    operation: 'submit',
    outcome: 'started',
  });
  telemetry.dispose();
  expect(telemetry.root.ended).toBe(true);
  expect(telemetry.root.attrs).toMatchObject({
    'input.outcome': 'abandoned',
    'input.pending_predictions_on_close': 1,
    'input.submission_pending_on_close': true,
  });
  expect(telemetry.root.children[0]).toMatchObject({
    ended: true,
    attrs: { 'input.outcome': 'unknown_after_close' },
  });
  telemetry.observe({
    event: 'changed',
    draftId: 'late',
    revision: 2,
    length: 10,
    reason: 'text',
  });
  expect(Telemetry.span).toHaveBeenCalledOnce();
  expect(telemetry.parent()).toBeUndefined();
});

it('measures first usable fields after an invalid form becomes valid without a new revision', () => {
  const telemetry = setup();
  telemetry.observe({
    event: 'ready',
    draftId: 'opaque',
    revision: 1,
    intent: 'email',
    valid: false,
  });
  telemetry.observe({
    event: 'ready',
    draftId: 'opaque',
    revision: 1,
    intent: 'email',
    valid: true,
  });
  telemetry.observe({
    event: 'ready',
    draftId: 'opaque',
    revision: 1,
    intent: 'email',
    valid: true,
  });
  const ready = telemetry.root.events.filter(
    (span) => span.name === 'universal_input.fields_ready'
  );
  expect(ready).toHaveLength(2);
  expect(ready[0].attrs['input.first_usable']).toBe(false);
  expect(ready[1].attrs['input.first_usable']).toBe(true);
  expect(ready[1].attrs['input.first_usable_ms']).toEqual(expect.any(Number));
  telemetry.dispose();
});

it('summarizes corrections, coalescing and completion with only bounded field metadata', () => {
  const telemetry = setup();
  telemetry.observe({
    event: 'type',
    draftId: 'opaque',
    previous: 'task',
    intent: 'email',
    manual: true,
  });
  telemetry.observe({
    event: 'field',
    draftId: 'opaque',
    intent: 'email',
    field: 'subject',
    inferred: true,
  });
  telemetry.observe({
    event: 'field',
    draftId: 'opaque',
    intent: 'email',
    field: 'subject',
    inferred: true,
  });
  telemetry.observe({
    event: 'queue',
    draftId: 'opaque',
    phase: 'extract',
    observation: { action: 'started', waitMs: 80, coalesced: 3 },
  });
  telemetry.observe({
    event: 'finished',
    draftId: 'opaque',
    outcome: 'submitted',
  });
  expect(telemetry.root.attrs).toMatchObject({
    'input.outcome': 'submitted',
    'input.fields_edited': 1,
    'input.fields_corrected': 1,
    'input.coalesced_updates': 3,
    'input.type_overrides': 1,
  });
  expect(
    telemetry.root.events.filter(
      (span) => span.name === 'universal_input.field_edit'
    )
  ).toHaveLength(1);
  expect(telemetry.root.ended).toBe(true);
});
