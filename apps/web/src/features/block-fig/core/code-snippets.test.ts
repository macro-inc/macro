import type { NodeInfo, TextInfo } from '@core/fig-engine/types';
import { describe, expect, it } from 'vitest';
import { codeFor, composeFor, swiftUIFor, tailwindFor } from './code-snippets';

const base: NodeInfo = {
  id: '1:2',
  name: 'Card',
  type: 'FRAME',
  typeLabel: 'Frame',
  x: 0,
  y: 0,
  panelMove: [1, 0, 0, 1],
  width: 320,
  height: 200,
  rotation: 0,
  bounds: { x: 0, y: 0, w: 320, h: 200 },
  opacity: 1,
  blendMode: 'PASS_THROUGH',
  visible: true,
  locked: false,
  cornerRadius: { top_left: 8, top_right: 8, bottom_right: 8, bottom_left: 8 },
  cornerSmoothing: null,
  clipsContent: true,
  fills: [
    {
      type: 'SOLID',
      visible: true,
      opacity: 1,
      blendMode: 'NORMAL',
      color: '0D99FF',
      alpha: 1,
      stops: null,
      handles: null,
      scaleMode: null,
      imageHash: null,
    },
  ],
  strokes: [],
  strokeWeight: null,
  strokeAlign: null,
  dashPattern: null,
  effects: [
    {
      type: 'DROP_SHADOW',
      visible: true,
      color: '000000',
      alpha: 0.25,
      x: 0,
      y: 4,
      radius: 12,
      spread: 0,
    },
  ],
  text: null,
  autoLayout: {
    mode: 'HORIZONTAL',
    spacing: 8,
    paddingTop: 12,
    paddingRight: 16,
    paddingBottom: 12,
    paddingLeft: 16,
    primaryAlign: 'SPACE_BETWEEN',
    counterAlign: 'CENTER',
    wrap: false,
    primarySizing: null,
    counterSizing: null,
    counterSpacing: 0,
    reverseZ: false,
  },
  constraints: null,
  exportSettings: [],
  layoutGrids: [],
  mainComponent: null,
  description: null,
  componentProperties: [],
  booleanOperation: null,
  isMask: false,
  childCount: 2,
  sizing: null,
  layoutParent: null,
  constrained: false,
};

const text: TextInfo = {
  characters: 'Say "hi"',
  truncated: false,
  fontFamily: 'Inter',
  fontStyle: 'Semi Bold',
  fontSize: 16,
  lineHeight: [24, 'PIXELS'],
  letterSpacing: null,
  paragraphSpacing: null,
  alignHorizontal: 'CENTER',
  alignVertical: null,
  decoration: null,
  case: null,
  autoResize: null,
  fonts: [],
  fontStatus: 'available' as TextInfo['fontStatus'],
  styleIds: [],
  runs: [],
};

const label: NodeInfo = {
  ...base,
  type: 'TEXT',
  autoLayout: null,
  cornerRadius: null,
  effects: [],
  text,
};

describe('code snippets', () => {
  it('writes Tailwind classes', () => {
    const classes = tailwindFor(base);
    expect(classes).toEqual(
      expect.arrayContaining([
        'w-[320px]',
        'h-[200px]',
        'bg-[#0D99FF]',
        'rounded-[8px]',
        'shadow-[0px_4px_12px_0px_rgba(0,_0,_0,_0.25)]',
        'flex',
        'flex-row',
        'gap-[8px]',
        'px-[16px]',
        'py-[12px]',
        'justify-between',
        'items-center',
      ])
    );
    expect(tailwindFor(label)).toEqual(
      expect.arrayContaining([
        'text-[#0D99FF]',
        "font-['Inter']",
        'text-[16px]',
        'font-[600]',
        'leading-[24px]',
        'text-center',
      ])
    );
  });

  it('writes SwiftUI', () => {
    const swift = swiftUIFor(base).join('\n');
    expect(swift).toContain('HStack(alignment: .center, spacing: 8) {');
    expect(swift).toContain('.padding(.leading, 16)');
    expect(swift).toContain('RoundedRectangle(cornerRadius: 8)');
    expect(swift).toContain(
      '.shadow(color: Color(red: 0, green: 0, blue: 0).opacity(0.25), radius: 6, x: 0, y: 4)'
    );
    const t = swiftUIFor(label).join('\n');
    expect(t).toContain('Text("Say \\"hi\\"")');
    expect(t).toContain('.font(.custom("Inter", size: 16).weight(.semibold))');
    expect(t).toContain('.multilineTextAlignment(.center)');
  });

  it('writes Jetpack Compose', () => {
    const row = composeFor(base).join('\n');
    expect(row.startsWith('Row(')).toBe(true);
    expect(row).toContain(
      '.background(color = Color(0xFF0D99FF), shape = RoundedCornerShape(size = 8.dp))'
    );
    expect(row).toContain('horizontalArrangement = Arrangement.SpaceBetween,');
    expect(row).toContain('verticalAlignment = Alignment.CenterVertically,');
    const t = composeFor(label).join('\n');
    expect(t).toContain('text = "Say \\"hi\\"",');
    expect(t).toContain('fontWeight = FontWeight(600),');
    expect(t).toContain('textAlign = TextAlign.Center,');
  });

  it('switches languages', () => {
    expect(codeFor(base, 'css')).toContain('width: 320px;');
    expect(codeFor(base, 'tailwind')).toContain('w-[320px] h-[200px]');
  });
});
