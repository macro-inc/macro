import type { NodeInfo } from '@core/fig-engine/types';
import { describe, expect, it } from 'vitest';
import { cssColor, cssFor, fontWeight } from './css';

const base: NodeInfo = {
  id: '1:2',
  name: 'Card',
  type: 'FRAME',
  typeLabel: 'Frame',
  x: 0,
  y: 0,
  width: 320,
  height: 200,
  rotation: 0,
  bounds: { x: 0, y: 0, w: 320, h: 200 },
  opacity: 1,
  blendMode: 'PASS_THROUGH',
  visible: true,
  locked: false,
  cornerRadius: null,
  cornerSmoothing: null,
  clipsContent: true,
  fills: [],
  strokes: [],
  strokeWeight: null,
  strokeAlign: null,
  dashPattern: null,
  effects: [],
  text: null,
  autoLayout: null,
  constraints: null,
  exportSettings: [],
  mainComponent: null,
  description: null,
  componentProperties: [],
  booleanOperation: null,
  isMask: false,
  childCount: 0,
};

const solid = (color: string, alpha = 1) => ({
  type: 'SOLID',
  visible: true,
  opacity: 1,
  blendMode: 'NORMAL',
  color,
  alpha,
  stops: null,
  handles: null,
  scaleMode: null,
  imageHash: null,
});

describe('css', () => {
  it('writes colors with and without alpha', () => {
    expect(cssColor('FF0000')).toBe('#FF0000');
    expect(cssColor('FF0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('describes a frame', () => {
    const lines = cssFor({
      ...base,
      fills: [solid('FFFFFF')],
      strokes: [solid('000000')],
      strokeWeight: 1,
      cornerRadius: {
        top_left: 8,
        top_right: 8,
        bottom_right: 8,
        bottom_left: 8,
      },
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          color: '000000',
          alpha: 0.25,
          x: 0,
          y: 4,
          radius: 4,
          spread: 0,
        },
      ],
    });
    expect(lines).toContain('background: #FFFFFF;');
    expect(lines).toContain('border: 1px solid #000000;');
    expect(lines).toContain('border-radius: 8px;');
    expect(lines).toContain('box-shadow: 0px 4px 4px 0px rgba(0, 0, 0, 0.25);');
  });

  it('describes text', () => {
    const lines = cssFor({
      ...base,
      type: 'TEXT',
      fills: [solid('333333')],
      text: {
        characters: 'Hi',
        truncated: false,
        fontFamily: 'Inter',
        fontStyle: 'Semi Bold',
        fontSize: 16,
        lineHeight: [150, 'PERCENT'],
        letterSpacing: [0, 'PERCENT'],
        paragraphSpacing: null,
        alignHorizontal: 'CENTER',
        alignVertical: 'TOP',
        decoration: null,
        case: null,
        autoResize: null,
        fonts: [],
      },
    });
    expect(lines).toContain('color: #333333;');
    expect(lines).toContain('font-family: "Inter";');
    expect(lines).toContain('font-weight: 600;');
    expect(lines).toContain('line-height: 150%;');
    expect(lines).toContain('text-align: center;');
  });

  it('maps font styles to weights', () => {
    expect(fontWeight('Bold Italic')).toBe(700);
    expect(fontWeight('ExtraLight')).toBe(200);
    expect(fontWeight('Regular')).toBe(400);
  });
});
