import { Telemetry } from '@macro-inc/observability';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../../../../packages/lexical-wasm-view/src/view/test/native-surface';
import { startEditorOperation, startEditorScrollTelemetry } from './editor';
import { initializeUiOperationTelemetry } from './ui-operation';

const { spans } = vi.hoisted(() => ({
  spans: [] as { name: string; attrs: Record<string, unknown>; ends: number }[],
}));
vi.mock('@macro-inc/observability', async (original) => {
  const actual = await original<typeof import('@macro-inc/observability')>();
  function span(name: string) {
    const record = { name, attrs: {} as Record<string, unknown>, ends: 0 };
    spans.push(record);
    return {
      ...actual.NOOP_SPAN,
      span,
      run: <T>(work: () => T) => work(),
      setAttr(key: string, value: unknown) {
        record.attrs[key] = value;
      },
      end() {
        record.ends++;
      },
    };
  }
  return {
    ...actual,
    Telemetry: {
      ...actual.Telemetry,
      span,
      config: { sampled: vi.fn(() => false) },
    },
  };
});
beforeAll(initializeNativeSurfaceTests);
let fixture: ReturnType<typeof nativeSurface>;
let owner: HTMLDivElement;
let dispose: (() => void) | undefined;
let disposeObserver: (() => void) | undefined;
let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  vi.mocked(Telemetry.config.sampled).mockReturnValue(false);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('PerformanceObserver', undefined);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  fixture = nativeSurface();
  frames.clear();
  spans.length = 0;
  owner = document.createElement('div');
  fixture.root.replaceWith(owner);
  owner.append(fixture.root);
  disposeObserver = initializeUiOperationTelemetry();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  disposeObserver?.();
  fixture.close();
  owner.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('installs no listeners or frame loop for an unsampled editor', () => {
  const listen = vi.spyOn(document, 'addEventListener');
  dispose = startEditorScrollTelemetry(fixture.view, 'fixture-document');
  expect(listen).not.toHaveBeenCalled();
  owner.dispatchEvent(new Event('scroll'));
  expect(frames.size).toBe(0);
  expect(spans).toHaveLength(0);
});

it('keeps native work open through two paint opportunities for long-task delivery', () => {
  vi.mocked(Telemetry.config.sampled).mockReturnValue(true);
  const operation = startEditorOperation('editor.paste', 'fixture-document');
  operation.finish('success');
  const paste = spans.find((s) => s.name === 'editor.paste');
  expect(paste?.ends).toBe(0);
  for (const time of [100, 116]) {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(time);
  }
  expect(paste?.ends).toBe(1);
  expect(paste?.attrs['editor.long_task.supported']).toBe(false);
  expect(paste?.attrs['editor.long_task.count']).toBeUndefined();
});

it('measures only ancestor scrolling and ends its frame loop after the quiet window', () => {
  vi.mocked(Telemetry.config.sampled).mockReturnValue(true);
  dispose = startEditorScrollTelemetry(fixture.view, 'fixture-document');
  const unrelated = document.createElement('div');
  document.body.append(unrelated);
  unrelated.dispatchEvent(new Event('scroll'));
  unrelated.remove();
  expect(spans).toHaveLength(0);
  owner.dispatchEvent(new Event('scroll'));
  for (const time of [100, 116, 156]) {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(time);
  }
  owner.dispatchEvent(new Event('scroll'));
  vi.advanceTimersByTime(180);
  const scroll = spans.find((s) => s.name === 'editor.scroll');
  expect(scroll?.ends).toBe(1);
  expect(scroll?.attrs).toMatchObject({
    'document.id': 'fixture-document',
    'editor.scroll.event_count': 2,
    'editor.frame.count': 2,
    'editor.frame.jank_count': 1,
    'editor.frame.max_ms': 40,
  });
  expect(frames.size).toBe(0);
});

it('bounds continuous scroll windows and cancels the active span on dispose', () => {
  vi.mocked(Telemetry.config.sampled).mockReturnValue(true);
  dispose = startEditorScrollTelemetry(fixture.view, 'fixture-document');
  for (let i = 0; i < 10; i++) {
    owner.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(100);
  }
  expect(spans.filter((s) => s.name === 'editor.scroll')).toHaveLength(1);
  expect(spans.find((s) => s.name === 'editor.scroll')?.ends).toBe(1);
  owner.dispatchEvent(new Event('scroll'));
  dispose();
  expect(
    spans.filter((s) => s.name === 'editor.scroll').every((s) => s.ends === 1)
  ).toBe(true);
  expect(frames.size).toBe(0);
  owner.dispatchEvent(new Event('scroll'));
  expect(spans.filter((s) => s.name === 'editor.scroll')).toHaveLength(2);
});
