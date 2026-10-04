import { ConcreteBlockRegistry } from '@core/block';
import { describe, expect, it } from 'vitest';

const definitionFiles = import.meta.glob('../../../features/*/definition.ts', {
  eager: true,
  import: 'default',
  query: '?raw',
});

describe('block definition discovery', () => {
  it('has one definition file for every concrete block', () => {
    const discoveredNames = Object.values(definitionFiles).map(
      (source) => String(source).match(/\bname:\s*['"]([^'"]+)['"]/)?.[1]
    );

    expect(discoveredNames.sort()).toEqual([...ConcreteBlockRegistry].sort());
  });
});
