import { describe, expect, it } from 'vitest';
import { githubLabelColors } from './github-label-colors';

describe('githubLabelColors', () => {
  it('tints the background and lightens dark label text on dark themes', () => {
    expect(githubLabelColors('560e3a', 'dark')).toEqual({
      color: 'hsl(323.3 72% 66.9%)',
      background: 'rgb(86 14 58 / 0.18)',
      border: 'hsl(323.3 72% 66.9% / 0.3)',
    });
    expect(githubLabelColors('#000000', 'dark').color).toBe('hsl(0 0% 60%)');
  });

  it('fills with the label color and picks readable text on light themes', () => {
    expect(githubLabelColors('E8572B', 'light')).toEqual({
      color: '#ffffff',
      background: 'rgb(232 87 43)',
      border: 'transparent',
    });
    expect(githubLabelColors('ffffff', 'light')).toEqual({
      color: '#000000',
      background: 'rgb(255 255 255)',
      border: 'hsl(0 0% 75%)',
    });
  });

  it('falls back to the default tag color for a missing or invalid color', () => {
    const fallback = githubLabelColors('889096', 'dark');
    expect(githubLabelColors(undefined, 'dark')).toEqual(fallback);
    expect(githubLabelColors('not-a-color', 'dark')).toEqual(fallback);
  });
});
