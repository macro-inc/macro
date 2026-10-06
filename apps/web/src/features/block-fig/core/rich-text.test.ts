import type { TextInfo } from '@core/fig-engine/types';
import { describe, expect, it } from 'vitest';
import { MIXED } from './mixed';
import {
  rangeStyle,
  styleAt,
  textFonts,
  textInfoForRange,
  toggleBold,
  toggleItalic,
  toggleUnderline,
} from './rich-text';

const run = (id: number, fields: Partial<TextInfo['runs'][number]>) => ({
  id,
  fontFamily: null,
  fontStyle: null,
  fontSize: null,
  decoration: null,
  letterSpacing: null,
  lineHeight: null,
  case: null,
  fills: null,
  fontStatus: 'AVAILABLE' as const,
  ...fields,
});

// "plain bold big": "bold" is Bold, "big" is 20 px and red.
const text: TextInfo = {
  characters: 'plain bold big',
  truncated: false,
  fontFamily: 'Roboto',
  fontStyle: 'Regular',
  fontSize: 12,
  lineHeight: null,
  letterSpacing: null,
  paragraphSpacing: null,
  alignHorizontal: null,
  alignVertical: null,
  decoration: null,
  case: null,
  autoResize: null,
  fonts: [],
  fontStatus: 'AVAILABLE',
  styleIds: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 2, 2, 2],
  runs: [
    run(1, { fontFamily: 'Roboto', fontStyle: 'Bold' }),
    run(2, {
      fontSize: 20,
      fills: [
        {
          type: 'SOLID',
          visible: true,
          opacity: 1,
          color: 'FF0000',
          alpha: 1,
        } as never,
      ],
    }),
  ],
};

describe('character styles', () => {
  it('resolves a character’s style over the layer’s', () => {
    expect(styleAt(text, 0)).toMatchObject({
      fontFamily: 'Roboto',
      fontStyle: 'Regular',
      fontSize: 12,
      fills: null,
    });
    expect(styleAt(text, 7).fontStyle).toBe('Bold');
    expect(styleAt(text, 12).fontSize).toBe(20);
  });

  it('shows what a range shares and what is mixed', () => {
    const r = rangeStyle(text, 0, 8);
    expect(r.fontFamily).toBe('Roboto');
    expect(r.fontStyle).toBe(MIXED);
    expect(r.fontSize).toBe(12);
    expect(rangeStyle(text, 11, 14).fills).not.toBe(MIXED);
    expect(rangeStyle(text, 9, 13).fills).toBe(MIXED);
    // A caret takes the style before it (what typing continues).
    expect(rangeStyle(text, 10, 10).fontStyle).toBe('Bold');
    expect(rangeStyle(text, 0, 0).fontStyle).toBe('Regular');
    // Backwards ranges work too.
    expect(rangeStyle(text, 8, 0).fontStyle).toBe(MIXED);
  });

  it('gives the Type section the range’s values', () => {
    const { text: shown, mixed } = textInfoForRange(text, 6, 14);
    expect([...mixed].sort()).toEqual(['fontSize', 'fontStyle']);
    expect(shown.fontFamily).toBe('Roboto');
    expect(shown.fontStyle).toBeNull();
    const bold = textInfoForRange(text, 6, 10);
    expect(bold.mixed.size).toBe(0);
    expect(bold.text.fontStyle).toBe('Bold');
  });

  it('lists the fonts a layer uses', () => {
    expect(textFonts(text)).toEqual([
      { family: 'Roboto', style: 'Regular' },
      { family: 'Roboto', style: 'Bold' },
    ]);
  });
});

describe('style shortcuts', () => {
  it('toggles bold, keeping italics', () => {
    expect(toggleBold(rangeStyle(text, 0, 5))).toEqual({ fontStyle: 'Bold' });
    expect(toggleBold(rangeStyle(text, 6, 10))).toEqual({
      fontStyle: 'Regular',
    });
    // A mix becomes bold, as in Figma.
    expect(toggleBold(rangeStyle(text, 0, 10))).toEqual({ fontStyle: 'Bold' });
    const italic = { ...text, fontStyle: 'Light Italic', styleIds: [] };
    expect(toggleBold(rangeStyle(italic, 0, 3))).toEqual({
      fontStyle: 'Bold Italic',
    });
  });

  it('toggles italic, keeping weight', () => {
    expect(toggleItalic(rangeStyle(text, 6, 10))).toEqual({
      fontStyle: 'Bold Italic',
    });
    const italic = { ...text, fontStyle: 'Semi Bold Italic', styleIds: [] };
    expect(toggleItalic(rangeStyle(italic, 0, 3))).toEqual({
      fontStyle: 'Semi Bold',
    });
  });

  it('toggles underline', () => {
    expect(toggleUnderline(rangeStyle(text, 0, 3))).toEqual({
      textDecoration: 'UNDERLINE',
    });
    const underlined = { ...text, decoration: 'UNDERLINE' };
    expect(toggleUnderline(rangeStyle(underlined, 0, 3))).toEqual({
      textDecoration: 'NONE',
    });
  });
});
