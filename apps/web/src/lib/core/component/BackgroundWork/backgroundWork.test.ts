import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { backgroundWork, showBackgroundWork } from './backgroundWork';

const removers: (() => void)[] = [];

afterEach(() => {
  for (const remove of removers.splice(0)) remove();
});

describe('backgroundWork', () => {
  it('is empty when nothing is under way', () => {
    expect(backgroundWork()).toEqual([]);
  });

  it('lists work while its summary gives one, oldest first', () => {
    const [detail, setDetail] = createSignal<string | undefined>(
      'Writing the steps'
    );
    const [shown, setShown] = createSignal(true);
    removers.push(
      showBackgroundWork(() =>
        shown() ? { label: 'Drafting routine', detail: detail() } : undefined
      ),
      showBackgroundWork(() => ({ label: 'Importing' }))
    );
    expect(backgroundWork()).toEqual([
      { label: 'Drafting routine', detail: 'Writing the steps' },
      { label: 'Importing' },
    ]);
    setDetail('Checking that it runs');
    expect(backgroundWork()[0]?.detail).toBe('Checking that it runs');
    setShown(false);
    expect(backgroundWork()).toEqual([{ label: 'Importing' }]);
  });

  it('stops showing work once it is taken away', () => {
    const remove = showBackgroundWork(() => ({ label: 'Drafting routine' }));
    remove();
    expect(backgroundWork()).toEqual([]);
  });
});
