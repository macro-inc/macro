import { NOOP_SPAN, Telemetry } from '@macro-inc/observability';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./flow', () => ({ beginInteraction: vi.fn() }));

// The Performance API is browser-owned; control its entries and clock, while
// observing the public telemetry calls used to reconstruct those entries.
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('starts at navigation time, lets the first view close its window, and aggregates resource timings without a second observer or resource spans', async () => {
  vi.useFakeTimers();
  const root = {
    ...NOOP_SPAN,
    run: <T>(fn: () => T) => fn(),
    setAttr: vi.fn(),
    event: vi.fn(),
    end: vi.fn(),
  };
  const phase = { ...NOOP_SPAN, setAttr: vi.fn(), end: vi.fn() };
  vi.spyOn(Telemetry, 'span').mockReturnValue(phase);
  vi.stubGlobal('performance', {
    timeOrigin: 1700000000000,
    now: () => 200,
    getEntriesByType: (type: string) => {
      if (type === 'navigation')
        return [
          {
            type: 'navigate',
            domainLookupStart: 1,
            domainLookupEnd: 2,
            connectStart: 2,
            connectEnd: 5,
            secureConnectionStart: 3,
            requestStart: 5,
            responseStart: 10,
            responseEnd: 20,
            domInteractive: 30,
          },
        ];
      if (type === 'mark')
        return [
          {
            name: 'macro.auth.refresh-start',
            startTime: 10,
            detail: { generation: 0 },
          },
          {
            name: 'macro.auth.refresh-start',
            startTime: 12,
            detail: { generation: 1 },
          },
          {
            name: 'macro.auth.refresh-end',
            startTime: 20,
            detail: { generation: 0 },
          },
          {
            name: 'macro.auth.refresh-end',
            startTime: 24,
            detail: { generation: 1 },
          },
          { name: 'macro.boot.render-start', startTime: 100 },
        ];
      if (type === 'resource')
        return [
          {
            name: 'https://example.com/private/path.wasm?token=secret',
            startTime: 30,
            responseEnd: 80,
            encodedBodySize: 100,
            decodedBodySize: 200,
            transferSize: 110,
          },
        ];
      return [];
    },
  });
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      static supportedEntryTypes: string[] = [];
    }
  );
  const { beginInteraction } = await import('./flow');
  const { startBootTrace } = await import('./boot');
  startBootTrace();
  startBootTrace();
  expect(beginInteraction).toHaveBeenCalledOnce();
  const [name, options] = vi.mocked(beginInteraction).mock.calls[0]!;
  expect(name).toBe('app.boot');
  expect(options).toMatchObject({ startTime: 0, closeOnJoin: true });
  options?.onFinish?.(root, 'success', 200);
  expect(root.setAttr).toHaveBeenCalledWith('boot.outcome', 'success');
  expect(Telemetry.span).toHaveBeenCalledWith('boot.auth.refresh', {
    startTime: 1700000000010,
  });
  expect(phase.end).toHaveBeenCalledWith(1700000000020);
  expect(Telemetry.span).toHaveBeenCalledWith('boot.auth.refresh', {
    startTime: 1700000000012,
  });
  expect(phase.end).toHaveBeenCalledWith(1700000000024);
  expect(root.event).toHaveBeenCalledWith(
    'macro.boot.render-start',
    undefined,
    1700000000100
  );
  expect(root.setAttr).toHaveBeenCalledWith('boot.resource.wasm.count', 1);
  expect(root.setAttr).toHaveBeenCalledWith(
    'boot.resource.wasm.encoded_bytes',
    100
  );
  expect(root.setAttr).toHaveBeenCalledWith(
    'boot.resource.wasm.transfer_bytes',
    110
  );
  expect(root.setAttr).toHaveBeenCalledWith(
    'boot.resource.wasm.duration_ms',
    50
  );
  expect(Telemetry.span).toHaveBeenCalledTimes(8);
  expect(
    vi.mocked(Telemetry.span).mock.calls.map(([name]) => name)
  ).not.toContain('boot.resource.wasm');
  expect(JSON.stringify(phase.setAttr.mock.calls)).not.toContain('secret');
  expect(JSON.stringify(root.setAttr.mock.calls)).not.toContain('private');
});
