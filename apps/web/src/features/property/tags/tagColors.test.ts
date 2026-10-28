import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAG_COLOR,
  optionColorOf,
  TAG_COLOR_OPTIONS,
} from './tagColors';

describe('option colours', () => {
  it('names the palette colour an option stores, in any case', () => {
    expect(optionColorOf('#0091FF')).toEqual({
      name: 'Blue',
      color: '#0091FF',
    });
    expect(optionColorOf('#e93d82')).toEqual({
      name: 'Pink',
      color: '#E93D82',
    });
  });

  it('names nothing for a colour outside the palette, or none at all', () => {
    expect(optionColorOf('#123456')).toBeUndefined();
    expect(optionColorOf(null)).toBeUndefined();
    expect(optionColorOf(undefined)).toBeUndefined();
  });

  it('keeps the picker order, gray last as the default', () => {
    expect(TAG_COLOR_OPTIONS.map((option) => option.color)).toEqual([
      '#E5484D',
      '#E54D2E',
      '#F76B15',
      '#FFB224',
      '#F5D90A',
      '#46A758',
      '#12A594',
      '#0091FF',
      '#3E63DD',
      '#8E4EC6',
      '#E93D82',
      '#889096',
    ]);
    expect(DEFAULT_TAG_COLOR).toBe('#889096');
  });
});
