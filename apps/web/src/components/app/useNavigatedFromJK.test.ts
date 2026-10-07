import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNavigatedFromJK } from './useNavigatedFromJK';

const mocks = vi.hoisted(() => ({
  soup: undefined as { rows: () => unknown[] } | undefined,
  command: undefined as { hotkeyToken: string } | undefined,
}));

vi.mock('@app/features/next-soup/soup-context', () => ({
  useMaybeSoup: () => mocks.soup,
}));
vi.mock('@core/hotkey/state', () => ({
  lastExecutedCommand: () => mocks.command,
}));
vi.mock('@core/hotkey/tokens', () => ({
  TOKENS: {
    entity: {
      step: { start: 'step-start', end: 'step-end' },
      select: { start: 'select-start', end: 'select-end' },
    },
  },
}));

const originalModality = document.documentElement.getAttribute('data-modality');

afterEach(() => {
  mocks.soup = undefined;
  mocks.command = undefined;
  if (originalModality === null) {
    document.documentElement.removeAttribute('data-modality');
  } else {
    document.documentElement.setAttribute('data-modality', originalModality);
  }
});

function navigatedFromJK() {
  return createRoot((dispose) => {
    try {
      return useNavigatedFromJK().navigatedFromJK();
    } finally {
      dispose();
    }
  });
}

describe('list keyboard navigation ownership', () => {
  it('remains mountable without a list provider', () => {
    expect(navigatedFromJK()).toBe(false);
  });

  it.each(['step-start', 'step-end', 'select-start', 'select-end'])(
    'recognizes %s from keyboard navigation with list rows',
    (hotkeyToken) => {
      mocks.soup = { rows: () => [{}] };
      mocks.command = { hotkeyToken };
      document.documentElement.setAttribute('data-modality', 'keyboard');
      expect(navigatedFromJK()).toBe(true);
    }
  );

  it.each([
    { modality: 'mouse', rows: [{}], hotkeyToken: 'step-end' },
    { modality: 'keyboard', rows: [], hotkeyToken: 'step-end' },
    { modality: 'keyboard', rows: [{}], hotkeyToken: 'unrelated' },
  ])('ignores navigation outside list keyboard stepping: %j', (state) => {
    mocks.soup = { rows: () => state.rows };
    mocks.command = { hotkeyToken: state.hotkeyToken };
    document.documentElement.setAttribute('data-modality', state.modality);
    expect(navigatedFromJK()).toBe(false);
  });
});
