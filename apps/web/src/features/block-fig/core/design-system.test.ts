import type { StyleInfo } from '@core/fig-engine/design-types';
import type { ComponentInfo } from '@core/fig-engine/types';
import { describe, expect, it } from 'vitest';
import {
  componentLabel,
  defaultPropertyName,
  groupComponents,
  groupStyles,
  splitStyleName,
  styleTypeFor,
  swapChoices,
  uniqueName,
  valueLabel,
} from './design-system';

const style = (
  name: string,
  type: StyleInfo['type'] = 'FILL',
  remote = false
): StyleInfo => ({
  id: name,
  name,
  type,
  description: null,
  remote,
  paints: [],
  effects: [],
  text: null,
});

const component = (
  id: string,
  name: string,
  set: string | null = null
): ComponentInfo => ({ id, name, set, page: 0, width: 10, height: 10 });

describe('styles', () => {
  it('splits folders from names', () => {
    expect(splitStyleName('Brand/Primary/500')).toEqual({
      folder: 'Brand/Primary',
      leaf: '500',
    });
    expect(splitStyleName('Plain')).toEqual({ folder: '', leaf: 'Plain' });
  });

  it('groups styles of a type by folder, libraries apart', () => {
    const groups = groupStyles(
      [
        style('Brand/Primary'),
        style('Heading', 'TEXT'),
        style('Gray'),
        style('Brand/Accent'),
        style('Shared/Blue', 'FILL', true),
      ],
      'FILL'
    );
    expect(groups.map((g) => [g.folder, g.styles.map((s) => s.name)])).toEqual([
      ['Brand', ['Brand/Primary', 'Brand/Accent']],
      ['', ['Gray']],
      ['Libraries / Shared', ['Shared/Blue']],
    ]);
    expect(
      groupStyles([style('Brand/Primary'), style('Gray')], 'FILL', 'gr')
    ).toEqual([{ folder: '', styles: [style('Gray')] }]);
  });

  it('stores stroke styles as color styles', () => {
    expect(styleTypeFor('STROKE')).toBe('FILL');
    expect(styleTypeFor('TEXT')).toBe('TEXT');
  });
});

describe('properties', () => {
  it('names new properties uniquely', () => {
    expect(uniqueName('Label', ['Label', 'Label 2'])).toBe('Label 3');
    expect(uniqueName('  ', [])).toBe('Property');
    expect(defaultPropertyName('BOOL', ['Show'])).toBe('Show 2');
    expect(defaultPropertyName('INSTANCE_SWAP', [])).toBe('Instance');
  });

  it('labels values', () => {
    expect(valueLabel({ bool: false, text: null, component: null })).toBe(
      'Off'
    );
    expect(valueLabel({ bool: null, text: 'Hi', component: null })).toBe('Hi');
    expect(
      valueLabel({
        bool: null,
        text: null,
        component: { id: '1:2', name: 'Star' },
      })
    ).toBe('Star');
  });
});

describe('components', () => {
  const list = [
    component('1:1', 'Icon/Star'),
    component('1:2', 'Size=Small', 'Button'),
    component('1:3', 'Size=Large', 'Button'),
    component('1:4', 'Avatar'),
  ];

  it('offers preferred swaps first', () => {
    const { preferred, others } = swapChoices(list, [
      { id: '1:4', name: 'Avatar' },
    ]);
    expect(preferred.map((c) => c.id)).toEqual(['1:4']);
    expect(others.map(componentLabel)).toEqual([
      'Button / Size=Large',
      'Button / Size=Small',
      'Icon/Star',
    ]);
    expect(swapChoices(list, [], 'star').others.map((c) => c.id)).toEqual([
      '1:1',
    ]);
  });

  it('groups component sets', () => {
    expect(
      groupComponents(list).map((g) => [g.set, g.components.map((c) => c.id)])
    ).toEqual([
      [null, ['1:1']],
      ['Button', ['1:2', '1:3']],
      [null, ['1:4']],
    ]);
    expect(groupComponents(list, 'large').map((g) => g.set)).toEqual([
      'Button',
    ]);
  });
});
