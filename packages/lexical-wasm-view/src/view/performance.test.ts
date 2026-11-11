// @vitest-environment jsdom
import { Telemetry } from '@macro-inc/observability';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
  transfer,
} from './test/native-surface';

const { spans } = vi.hoisted(() => ({
  spans: [] as {
    name: string;
    attrs: Record<string, unknown>;
    ends: number;
    errors: number;
  }[],
}));
vi.mock('@macro-inc/observability', async (original) => {
  const actual = await original<typeof import('@macro-inc/observability')>();
  function span(name: string) {
    const record = {
      name,
      attrs: {} as Record<string, unknown>,
      ends: 0,
      errors: 0,
    };
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
      error() {
        record.errors++;
      },
    };
  }
  return {
    ...actual,
    Telemetry: {
      ...actual.Telemetry,
      span,
      config: { sampled: vi.fn(() => true) },
    },
  };
});
beforeAll(initializeNativeSurfaceTests);
beforeEach(() => {
  spans.length = 0;
  vi.mocked(Telemetry.config.sampled).mockReturnValue(true);
});

test('paste measures real native completion and sizes without recording content', async () => {
  const fixture = nativeSurface();
  const scan = vi.spyOn(fixture.root, 'querySelectorAll');
  try {
    spans.length = 0;
    expect(
      await fixture.view.clipboard.paste(transfer('abc😀'), {
        kind: 'range',
        anchor: { key: 0, offset: 0, type: 'element' },
        focus: { key: 0, offset: 0, type: 'element' },
      })
    ).toBe(true);
    expect(fixture.view.mirror.textLength).toBe(5);
    const paste = spans.find((s) => s.name === 'editor.paste');
    expect(paste?.ends).toBe(1);
    expect(paste?.attrs).toMatchObject({
      'editor.outcome': 'success',
      'editor.document.text_code_units': 5,
      'editor.document.block_count': 1,
      'editor.paste.clipboard_code_units': 5,
    });
    expect(spans.map((s) => s.name)).toContain('editor.paste.session_input');
    expect(Object.values(paste?.attrs ?? {})).not.toContain('abc😀');
    expect(scan).not.toHaveBeenCalledWith('*');
  } finally {
    fixture.close();
  }
});

test('queued admission keeps its span open until the real native output completes', async () => {
  const fixture = nativeSurface();
  const original = fixture.port.input.bind(fixture.port);
  let deliver: (() => void) | undefined;
  vi.spyOn(fixture.port, 'input').mockImplementation((input, after) => {
    deliver = () => original(input, after);
  });
  try {
    spans.length = 0;
    expect(
      await fixture.view.clipboard.paste(transfer('queued'), {
        kind: 'range',
        anchor: { key: 0, offset: 0, type: 'element' },
        focus: { key: 0, offset: 0, type: 'element' },
      })
    ).toBe(true);
    const paste = spans.find((s) => s.name === 'editor.paste');
    expect(paste?.ends).toBe(0);
    expect(fixture.root.textContent).toBe('');
    expect(deliver).toBeDefined();
    deliver?.();
    expect(fixture.root.textContent).toBe('queued');
    expect(paste?.ends).toBe(1);
    expect(paste?.attrs['editor.outcome']).toBe('success');
    expect(
      spans.find((s) => s.name === 'editor.paste.completion_wait')?.ends
    ).toBe(1);
  } finally {
    fixture.close();
  }
});

test('dispose ends a queued paste once and late completion cannot change its outcome', async () => {
  const fixture = nativeSurface();
  let complete: ((handled: boolean) => void) | undefined;
  vi.spyOn(fixture.port, 'input').mockImplementation((_input, after) => {
    complete = after;
  });
  spans.length = 0;
  expect(
    await fixture.view.clipboard.paste(transfer('pending'), {
      kind: 'range',
      anchor: { key: 0, offset: 0, type: 'element' },
      focus: { key: 0, offset: 0, type: 'element' },
    })
  ).toBe(true);
  const paste = spans.find((s) => s.name === 'editor.paste');
  expect(paste?.ends).toBe(0);
  fixture.close();
  expect(paste?.ends).toBe(1);
  expect(paste?.attrs['editor.outcome']).toBe('cancelled');
  complete?.(false);
  expect(paste?.ends).toBe(1);
  expect(paste?.attrs['editor.outcome']).toBe('cancelled');
});

test('unsampled edits add no performance spans or document-wide DOM counts', async () => {
  vi.mocked(Telemetry.config.sampled).mockReturnValue(false);
  const fixture = nativeSurface();
  const scan = vi.spyOn(fixture.root, 'querySelectorAll');
  try {
    spans.length = 0;
    expect(
      await fixture.view.clipboard.paste(transfer('unsampled'), {
        kind: 'range',
        anchor: { key: 0, offset: 0, type: 'element' },
        focus: { key: 0, offset: 0, type: 'element' },
      })
    ).toBe(true);
    expect(fixture.root.textContent).toBe('unsampled');
    expect(spans).toHaveLength(0);
    expect(scan).not.toHaveBeenCalledWith('*');
  } finally {
    fixture.close();
  }
});
