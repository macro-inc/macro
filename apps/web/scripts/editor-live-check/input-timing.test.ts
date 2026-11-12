import { expect, test } from 'vitest';
import { classifySplitUndo, summarizeInputTiming } from './input-timing';

function burst(first: number, last: number, trusted = true) {
  return [
    ...[0, 20, 40].map((performanceMs) => ({
      type: 'beforeinput',
      inputType: 'insertText',
      data: '`',
      trusted: true,
      performanceMs,
    })),
    {
      type: 'beforeinput',
      inputType: 'insertParagraph',
      data: null,
      trusted: true,
      performanceMs: 80,
    },
    {
      type: 'beforeinput',
      inputType: 'insertText',
      data: 'a',
      trusted,
      performanceMs: first,
    },
    {
      type: 'beforeinput',
      inputType: 'insertText',
      data: 'b',
      trusted,
      performanceMs: last,
    },
  ];
}

test('a full code-entry burst can be slow while every text gap stays under400', () => {
  const timing = summarizeInputTiming(burst(161, 554), 'ab');
  expect(timing.complete).toBe(true);
  expect(timing.maxTextGapMs).toBe(393);
  expect(timing.totalCodeBurstMs).toBe(554);
  expect(classifySplitUndo(true, timing)).toBe(
    'matches OFF under slow input; strict failure retained'
  );
});

test('a long individual text gap retains its captured classification', () => {
  expect(summarizeInputTiming(burst(100, 550), 'ab').slowInput).toBe(true);
});

test('fast input and an exact400 boundary do not classify a strict failure', () => {
  for (const end of [200, 400]) {
    expect(summarizeInputTiming(burst(100, end), 'ab').slowInput).toBe(false);
  }
});

test('incomplete or untrusted input cannot justify a slow-input classification', () => {
  expect(summarizeInputTiming(burst(100, 600, false), 'ab').slowInput).toBe(
    false
  );
  expect(summarizeInputTiming(burst(100, 600), 'abc').slowInput).toBe(false);
});

test('a clean Undo is never relabeled as a failure by slow timing alone', () => {
  expect(
    classifySplitUndo(false, summarizeInputTiming(burst(100, 600), 'ab'))
  ).toBe('no split Undo failure');
});
