import type { CompletionContext } from '@ironcalc/wasm';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createFormulaAssistance } from './create-formula-assistance';

const context = (prefix: string): CompletionContext => ({
  expecting: [{ FunctionName: prefix }],
  replace_from: 0,
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('formula assistance coordination', () => {
  it('coalesces keystrokes, discards stale answers, and ignores results after dismissal', async () => {
    const requests: ((result: CompletionContext) => void)[] = [];
    const complete = vi.fn(
      () => new Promise<CompletionContext>((resolve) => requests.push(resolve))
    );
    const [help, dispose] = createRoot(
      (dispose) =>
        [createFormulaAssistance(complete, vi.fn()), dispose] as const
    );
    help.update('=S', 2);
    help.update('=SU', 3);
    help.update('=SUM', 4);
    expect(complete).toHaveBeenCalledTimes(1);
    requests[0](context('S'));
    await flush();
    expect(help.completion()).toBeUndefined();
    expect(complete).toHaveBeenLastCalledWith('=SUM', 4);
    help.dismiss();
    requests[1](context('SUM'));
    await flush();
    expect(help.completion()).toBeUndefined();
    dispose();
  });
  it('accepts with Tab, dismisses with Escape, and leaves composition and modified keys alone', async () => {
    const replace = vi.fn();
    const [help, dispose] = createRoot(
      (dispose) =>
        [
          createFormulaAssistance(async () => context('SU'), replace),
          dispose,
        ] as const
    );
    help.update('=SU', 3);
    await flush();
    expect(
      help.keyDown(
        new KeyboardEvent('keydown', { key: 'Enter', isComposing: true })
      )
    ).toBe(false);
    expect(
      help.keyDown(new KeyboardEvent('keydown', { key: 'Enter', altKey: true }))
    ).toBe(false);
    expect(
      help.keyDown(
        new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
      )
    ).toBe(true);
    expect(replace).toHaveBeenCalledWith('=SUM(', 5);
    await flush();
    expect(
      help.keyDown(
        new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      )
    ).toBe(true);
    expect(help.completion()).toBeUndefined();
    dispose();
  });
});
