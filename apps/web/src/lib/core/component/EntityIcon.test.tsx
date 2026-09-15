/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { EntityIcon, getIconConfig } from './EntityIcon';

vi.mock('@core/constant/allBlocks', () => ({
  blockAcceptedFileExtensionSet: new Set(),
  fileTypeToBlockName: () => 'unknown',
  isBlockAlias: () => false,
  itemToBlockName: () => 'unknown',
}));

describe('EntityIcon weight', () => {
  it('selects the requested weight from the icon config', () => {
    expect(getIconConfig('md', 'bold').icon).toBe(getIconConfig('md').boldIcon);
    expect(getIconConfig('md').icon).not.toBe(getIconConfig('md').boldIcon);
  });

  it('reacts to weight changes', () => {
    const [weight, setWeight] = createSignal<'regular' | 'bold'>('regular');
    const view = render(() => <EntityIcon targetType="md" weight={weight()} />);
    const regularPath = view.container.querySelector('path')?.getAttribute('d');

    setWeight('bold');

    expect(view.container.querySelector('path')?.getAttribute('d')).not.toBe(
      regularPath
    );
  });
});
