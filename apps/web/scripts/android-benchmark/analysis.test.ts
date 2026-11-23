import { describe, expect, it } from 'vitest';
import { parseOtlpTraces } from './otlp';
import { quantile, summarize } from './stats';

describe('parseOtlpTraces', () => {
  it('flattens spans with typed attributes and millisecond times', () => {
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'app.platform', value: { stringValue: 'android' } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'a1',
                  spanId: 'b2',
                  parentSpanId: '',
                  name: 'navigation',
                  startTimeUnixNano: '1763390000123456789',
                  endTimeUnixNano: '1763390000623456789',
                  attributes: [
                    { key: 'route.id', value: { stringValue: 'view-mail' } },
                    { key: 'ui.elapsed_ms', value: { doubleValue: 500.5 } },
                    { key: 'flow.phase_count', value: { intValue: '3' } },
                    { key: 'block.data.waited', value: { boolValue: false } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const [span] = parseOtlpTraces(body);
    expect(span.parentSpanId).toBeUndefined();
    expect(span.end - span.start).toBeCloseTo(500, 3);
    expect(span.start).toBeCloseTo(1763390000123.456, 3);
    expect(span.attributes).toEqual({
      'route.id': 'view-mail',
      'ui.elapsed_ms': 500.5,
      'flow.phase_count': 3,
      'block.data.waited': false,
    });
    expect(span.resource['app.platform']).toBe('android');
  });
});

describe('summarize', () => {
  it('interpolates quantiles', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9)).toBe(91);
  });

  it('reports a robust spread and the change it can detect', () => {
    const summary = summarize([100, 102, 98, 101, 99, 100, 300]);
    expect(summary.median).toBe(100);
    expect(summary.max).toBe(300);
    // One outlier barely moves the MAD-based spread.
    expect(summary.robustSd).toBeCloseTo(1.4826, 4);
    expect(summary.detectableChange).toBeCloseTo(
      (2.8 * Math.SQRT2 * 1.2533 * 1.4826) / Math.sqrt(7),
      6
    );
  });
});
