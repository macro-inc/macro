import { Telemetry } from '@macro-inc/observability';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  reportRowHeightMismatch,
  resetRowHeightTelemetry,
  sampleRow,
} from './row-height-telemetry';

const attributes = new Map<string, unknown>();
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    anonymousSpan: vi.fn(() => ({
      setAttr: (key: string, value: unknown) => attributes.set(key, value),
      end: vi.fn(),
    })),
  },
}));

const CELL_TEXT = [
  'person.one@example.com',
  'https://example.com/private/path',
  'Jordan Example',
  '01990000-0000-7000-8000-00000000e001',
];

function row(options: { preview?: boolean; height: number; content: number }) {
  const element = document.createElement('div');
  element.setAttribute('role', 'row');
  element.dataset.gridRowId = CELL_TEXT[3];
  if (options.preview) element.setAttribute('data-grid-preview', '');
  element.innerHTML = `
    <div role="gridcell"><a href="mailto:${CELL_TEXT[0]}">${CELL_TEXT[0]}</a></div>
    <div role="gridcell"><a href="${CELL_TEXT[1]}">${CELL_TEXT[1]}</a></div>
    <div role="gridcell">${CELL_TEXT[2]}</div>`;
  Object.defineProperty(element, 'offsetHeight', { value: options.height });
  for (const cell of element.querySelectorAll('[role=gridcell]'))
    Object.defineProperty(cell, 'scrollHeight', { value: options.content });
  return element;
}

beforeEach(() => {
  attributes.clear();
  vi.mocked(Telemetry.anonymousSpan).mockClear();
  resetRowHeightTelemetry();
});

it('reports a mismatch with numbers and enums only, never cell text or ids', () => {
  const samples = [
    sampleRow(row({ height: 41, content: 40 }), 3, 41),
    sampleRow(row({ height: 57, content: 56 }), 7, 41),
    sampleRow(row({ preview: true, height: 41, content: 56 }), 120, 41),
  ];
  expect(
    reportRowHeightMismatch(
      {
        samples,
        estimate: 41,
        columnKinds: ['STRING', 'LINK', 'NUMBER', 'STRING'],
        fontsLoaded: false,
        viewportWidth: 900,
      },
      100_000
    )
  ).toBe(true);

  expect(Telemetry.anonymousSpan).toHaveBeenCalledWith(
    'database.row_height_mismatch'
  );
  expect(Object.fromEntries(attributes)).toEqual({
    'row_height.mounted_rows': 3,
    'row_height.mismatched_rows': 2,
    'row_height.mismatched_preview': 1,
    'row_height.mismatched_link': 1,
    'row_height.mismatched_plain': 0,
    'row_height.clipped_rows': 1,
    'row_height.estimate': 41,
    'row_height.slot': 41,
    'row_height.rendered': 57,
    'row_height.content': 56,
    'row_height.rendering': 'link',
    'row_height.index_bucket': '<10',
    'row_height.column_kinds': 'LINK,NUMBER,STRING',
    'row_height.fonts_loaded': false,
    'row_height.viewport_bucket': '<1024',
  });
  const payload = JSON.stringify([...attributes]);
  for (const text of [...CELL_TEXT, '@', 'http', 'example', 'Jordan'])
    expect(payload).not.toContain(text);
});

it('sends nothing when every row fills its slot', () => {
  expect(
    reportRowHeightMismatch(
      {
        samples: [sampleRow(row({ height: 41, content: 40 }), 0, 41)],
        estimate: 41,
        columnKinds: ['STRING'],
        fontsLoaded: true,
        viewportWidth: 1280,
      },
      100_000
    )
  ).toBe(false);
  expect(Telemetry.anonymousSpan).not.toHaveBeenCalled();
});

it('sends at most three reports a session, a minute apart', () => {
  const report = {
    samples: [sampleRow(row({ height: 57, content: 56 }), 0, 41)],
    estimate: 41,
    columnKinds: ['STRING'],
    fontsLoaded: true,
    viewportWidth: 1280,
  };
  expect(reportRowHeightMismatch(report, 100_000)).toBe(true);
  expect(reportRowHeightMismatch(report, 130_000)).toBe(false);
  expect(reportRowHeightMismatch(report, 160_000)).toBe(true);
  expect(reportRowHeightMismatch(report, 220_000)).toBe(true);
  expect(reportRowHeightMismatch(report, 400_000)).toBe(false);
  expect(Telemetry.anonymousSpan).toHaveBeenCalledTimes(3);
});
