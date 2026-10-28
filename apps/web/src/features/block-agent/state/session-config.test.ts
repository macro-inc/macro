import { describe, expect, it } from 'vitest';
import {
  effortConfigOption,
  effortLabel,
  type SelectSessionConfigOption,
} from './session-config';

const config: SelectSessionConfigOption = {
  id: 'reasoning_effort',
  name: 'Reasoning effort',
  category: 'thought_level',
  type: 'select',
  description: null,
  currentValue: 'default',
  options: ['default', 'low', 'medium', 'high'].map((value) => ({
    value,
    name: value[0].toUpperCase() + value.slice(1),
    group: null,
    description: null,
  })),
};

describe('native effort presentation', () => {
  it('preserves the runtime default without assuming a reasoning level', () => {
    const option = effortConfigOption([config]);
    expect(option?.options.map((choice) => choice.value)).toEqual([
      'default',
      'low',
      'medium',
      'high',
    ]);
    expect(effortLabel(option)).toBe('Default');
    expect(effortLabel(option, 'default')).toBe('Default');
    expect(effortLabel(option, 'low')).toBe('Low');
  });

  it('preserves external harness choices', () => {
    const external = { ...config, id: 'external-effort' };
    expect(effortConfigOption([external])).toBe(external);
    expect(effortLabel(external)).toBe('Default');
  });
});
