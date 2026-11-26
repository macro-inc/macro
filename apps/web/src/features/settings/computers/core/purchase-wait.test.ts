import { describe, expect, it } from 'vitest';
import { boughtComputerProgress } from './purchase-wait';

describe('boughtComputerProgress', () => {
  const bought = { id: 'computer-1', status: 'purchasing' as const };

  it('waits while it is bought, set up and started, and before it is listed', () => {
    expect(boughtComputerProgress([bought], 'computer-1')).toBe('waiting');
    expect(
      boughtComputerProgress([{ ...bought, status: 'starting' }], 'computer-1')
    ).toBe('waiting');
    expect(boughtComputerProgress([], 'computer-1')).toBe('waiting');
  });

  it('is ready once it runs, and failed or gone otherwise', () => {
    expect(
      boughtComputerProgress([{ ...bought, status: 'ready' }], 'computer-1')
    ).toBe('ready');
    expect(
      boughtComputerProgress([{ ...bought, status: 'failed' }], 'computer-1')
    ).toBe('failed');
    expect(
      boughtComputerProgress([{ ...bought, status: 'released' }], 'computer-1')
    ).toBe('gone');
  });
});
