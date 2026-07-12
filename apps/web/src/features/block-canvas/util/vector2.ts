import type { CanvasEdge } from '../model/CanvasModel';
import type { Rectangle } from './rectangle';

/*
 * Vector data and operation for the Canvas Block.
 */
export type Vector2 = [number, number] & {
  x: number;
  y: number;
  add(other: Vector2): Vector2;
  subtract(other: Vector2): Vector2;
  multiply(scalar: Vector2 | number): Vector2;
  divide(scalar: Vector2 | number): Vector2;
  dot(other: Vector2): number;
  length(): number;
  normalize(): Vector2;
  distance(other: Vector2): number;
  angle(): number;
  clone(): Vector2;
  equals(other: Vector2): boolean;
  setTo(x: number, y: number): void;
  setFrom(other: Vector2): void;
  mag(): number;
  distanceSq(other: Vector2): number;
};

export type Vector2Like =
  | Vector2
  | {
      x: number;
      y: number;
    };

const vectorMethods = {
  add(this: Vector2, other: Vector2): Vector2 {
    return vec2(this[0] + other[0], this[1] + other[1]);
  },

  subtract(this: Vector2, other: Vector2): Vector2 {
    return vec2(this[0] - other[0], this[1] - other[1]);
  },

  multiply(this: Vector2, scalar: number | Vector2): Vector2 {
    if (typeof scalar === 'number') {
      return vec2(this[0] * scalar, this[1] * scalar);
    }
    return vec2(this[0] * scalar[0], this[1] * scalar[1]);
  },

  divide(this: Vector2, scalar: number | Vector2): Vector2 {
    if (typeof scalar === 'number') {
      if (scalar === 0) throw new Error('Division by zero');
      return vec2(this[0] / scalar, this[1] / scalar);
    }
    if (scalar[0] === 0) throw new Error('Division by zero');
    if (scalar[1] === 0) throw new Error('Division by zero');
    return vec2(this[0] / scalar[0], this[1] / scalar[1]);
  },

  dot(this: Vector2, other: Vector2): number {
    return this[0] * other[0] + this[1] * other[1];
  },

  length(this: Vector2): number {
    return Math.sqrt(this[0] * this[0] + this[1] * this[1]);
  },

  normalize(this: Vector2): Vector2 {
    const len = this.length();
    if (len === 0) return vec2(0, 0);
    return this.divide(len);
  },

  distance(this: Vector2, other: Vector2): number {
    return Math.sqrt(
      Math.pow(other[0] - this[0], 2) + Math.pow(other[1] - this[1], 2)
    );
  },

  angle(this: Vector2): number {
    return Math.atan2(this[1], this[0]);
  },

  clone(this: Vector2): Vector2 {
    return vec2(this[0], this[1]);
  },

  equals(this: Vector2, other: Vector2): boolean {
    return this[0] === other[0] && this[1] === other[1];
  },

  toString(this: Vector2): string {
    return `vec2(${this[0]}, ${this[1]})`;
  },

  setTo(this: Vector2, x: number, y: number): void {
    this[0] = x;
    this[1] = y;
  },

  setFrom(this: Vector2, other: Vector2): void {
    this[0] = other[0];
    this[1] = other[1];
  },

  mag(this: Vector2): number {
    return Math.sqrt(this[0] * this[0] + this[1] * this[1]);
  },

  distanceSq(this: Vector2, other: Vector2): number {
    const dx = other[0] - this[0];
    const dy = other[1] - this[1];
    return dx * dx + dy * dy;
  },
};

// Shared handler for all Vector2 proxies
const vectorHandler: ProxyHandler<Vector2> = {
  get(target, prop, receiver) {
    if (prop === 'x') return target[0];
    if (prop === 'y') return target[1];
    if (prop in vectorMethods)
      return vectorMethods[prop as keyof typeof vectorMethods].bind(receiver);
    return target[prop as any];
  },

  set(target, prop, value) {
    if (prop === 'x') target[0] = value;
    if (prop === 'y') target[1] = value;
    if (prop === '0') target[0] = value;
    if (prop === '1') target[1] = value;
    return true;
  },
};

/**
 * Creates a new Vector2 instance.
 * @param x The x-coordinate of the vector.
 * @param y The y-coordinate of the vector.
 * @returns A new Vector2 instance.
 */
export function vec2(x: number, y: number): Vector2 {
  return new Proxy([x, y] as Vector2, vectorHandler);
}

// Vec2 namespace with some static helpers.
export const Vec2 = {
  zero: vec2(0, 0),
  one: vec2(1, 1),
  up: vec2(0, 1),
  down: vec2(0, -1),
  left: vec2(-1, 0),
  right: vec2(1, 0),

  fromAngle(angle: number, length = 1): Vector2 {
    return vec2(Math.cos(angle) * length, Math.sin(angle) * length);
  },

  lerp(a: Vector2, b: Vector2, t: number): Vector2 {
    return vec2(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
  },

  calculateRatioVect(
    edge: CanvasEdge,
    initialBoundingRect: Rectangle
  ): { from: Vector2 | undefined; to: Vector2 | undefined } {
    const from =
      edge.from.type === 'free'
        ? vec2(
            (edge.from.x - initialBoundingRect.x) / initialBoundingRect.w,
            (edge.from.y - initialBoundingRect.y) / initialBoundingRect.h
          )
        : undefined;
    const to =
      edge.to.type === 'free'
        ? vec2(
            (edge.to.x - initialBoundingRect.x) / initialBoundingRect.w,
            (edge.to.y - initialBoundingRect.y) / initialBoundingRect.h
          )
        : undefined;

    return { from, to };
  },

  applyRatioVect(inner: Vector2Like, outer: Rectangle): Vector2 {
    return vec2(inner.x * outer.w + outer.x, inner.y * outer.h + outer.y);
  },

  // Offset a source vector towards a target vector by a given fixed-pixel offset.
  offsetTowards(source: Vector2, target: Vector2, offset: number): Vector2 {
    return source.add(target.subtract(source).normalize().multiply(offset));
  },
};
