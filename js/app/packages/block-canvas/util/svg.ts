import type { CanvasEntityStyle } from '@block-canvas/model/CanvasModel';
import type { JSX } from 'solid-js';
import { type Vector2, vec2 } from './vector2';

type Segment = string;

export class PathBuilder {
  private segments: Segment[];
  private prevPoint: Vector2 = vec2(0, 0);
  private startPoint: Vector2 = vec2(0, 0);
  private started = false;

  constructor(start?: Vector2) {
    this.segments = [];
    if (start) {
      this.startPoint.setTo(start.x, start.y);
      this.prevPoint.setTo(start.x, start.y);
      this.started = true;
    }
  }

  moveTo(x: number, y: number) {
    this.segments.push(`M ${x} ${y}`);
    this.prevPoint = vec2(x, y);
    if (!this.started) {
      this.started = true;
      this.startPoint.setTo(x, y);
    }
    return this;
  }

  lineTo(x: number, y: number) {
    this.segments.push(`L ${x} ${y}`);
    this.prevPoint.setTo(x, y);
    return this;
  }

  cubicBezierTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number
  ) {
    this.segments.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x} ${y}`);
    this.prevPoint.setTo(x, y);
    return this;
  }

  quadraticBezierTo(cpx: number, cpy: number, x: number, y: number) {
    this.segments.push(`Q ${cpx} ${cpy} ${x} ${y}`);
    this.prevPoint.setTo(x, y);
    return this;
  }

  close() {
    this.segments.push('Z');
    this.prevPoint.setTo(this.startPoint.x, this.startPoint.y);
    return this;
  }

  arcTo(
    radius: number,
    x: number,
    y: number,
    largeArc: boolean,
    sweep: boolean
  ) {
    this.segments.push(
      `A ${radius} ${radius} 0 ${largeArc ? 1 : 0} ${sweep ? 1 : 0} ${x} ${y}`
    );
    this.prevPoint.setTo(x, y);
    return this;
  }

  toString() {
    return this.segments.join(' ');
  }

  flush() {
    const str = this.toString();
    this.segments = [];
    this.started = false;
    this.startPoint.setTo(0, 0);
    this.prevPoint.setTo(0, 0);
    return str;
  }

  roundedPolyline(points: Vector2[], radius: number) {
    if (points.length < 2) {
      console.error('Polyline must have at least 2 points');
      return this;
    }

    this.moveTo(points[0].x, points[0].y);

    if (points.length === 2) {
      this.lineTo(points[1].x, points[1].y);
      return this;
    }

    for (let i = 0; i < points.length - 1; i++) {
      const current = points[i];
      const next = points[i + 1];

      if (i < points.length - 2) {
        const afterNext = points[i + 2];

        const v1 = next.subtract(current);
        const v2 = afterNext.subtract(next);

        const v1Norm = v1.normalize();
        const v2Norm = v2.normalize();

        const v1Len = v1.length();
        const v2Len = v2.length();

        const maxRadius = Math.min(v1Len, v2Len) / 2;
        const limitedRadius = Math.min(radius, maxRadius);

        const cornerStart = next.subtract(v1Norm.multiply(limitedRadius));
        const cornerEnd = next.add(v2Norm.multiply(limitedRadius));

        const cp1 = vec2(
          cornerStart.x + v1Norm.x * limitedRadius * 0.55,
          cornerStart.y + v1Norm.y * limitedRadius * 0.55
        );

        const cp2 = vec2(
          cornerEnd.x - v2Norm.x * limitedRadius * 0.55,
          cornerEnd.y - v2Norm.y * limitedRadius * 0.55
        );

        this.lineTo(cornerStart.x, cornerStart.y);

        this.cubicBezierTo(
          cp1.x,
          cp1.y,
          cp2.x,
          cp2.y,
          cornerEnd.x,
          cornerEnd.y
        );
      } else {
        this.lineTo(next.x, next.y);
      }
    }

    return this;
  }
}

export const parseTranslate = (transformText: string): Vector2 => {
  const matches = transformText.match(/translate\(\s?(\d+),\s?(\d+)/);
  const x = parseInt(matches?.at(1) || '0');
  const y = parseInt(matches?.at(2) || '0');
  return vec2(x, y);
};

export const parseScale = (transformText: string): number => {
  const matches = transformText.match(/scale\(\s?(\d*\.?\d*)/);
  return parseFloat(matches?.at(1) || '1');
};

export const getTextWidth = (text: string, font: string): number => {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }
  return 0;
};

type entityStyleType = 'number' | 'string';

type svgEntityStyleEntry = {
  svgAttribute:
    | keyof JSX.UseSVGAttributes<SVGGElement>
    | 'rx'
    | 'ry'
    | 'cx'
    | 'cy';
  styleProperty: keyof CanvasEntityStyle;
  type: entityStyleType;
  applyScale: boolean;
};

export const svgEntityStyles: svgEntityStyleEntry[] = [
  {
    svgAttribute: 'font-size',
    styleProperty: 'textSize',
    type: 'number',
    applyScale: true,
  },
  {
    svgAttribute: 'fill',
    styleProperty: 'fillColor',
    type: 'string',
    applyScale: false,
  },
  {
    svgAttribute: 'stroke',
    styleProperty: 'strokeColor',
    type: 'string',
    applyScale: false,
  },
  {
    svgAttribute: 'stroke-width',
    styleProperty: 'strokeWidth',
    type: 'number',
    applyScale: true,
  },
  {
    svgAttribute: 'opacity',
    styleProperty: 'opacity',
    type: 'number',
    applyScale: false,
  },
] as const;
