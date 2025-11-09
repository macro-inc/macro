import type { JSX } from 'solid-js';
import { type Anchor, Corners, type Edge, Edges } from '../constants';
import type { CanvasNode, PencilNode } from '../model/CanvasModel';
import { lineSegmentIntersection } from './intersect';
import { type Vector2, vec2 } from './vector2';

/**
 * A Rectangle -  the building block of the geometric logic for canvas nodes.
 */
export type Rectangle = {
  position: Vector2;
  size: Vector2;

  x: number;
  y: number;
  w: number;
  h: number;
  width: number;
  height: number;

  left: number;
  right: number;
  top: number;
  bottom: number;
  center: Vector2;

  // Methods
  containsPoint(point: Vector2): boolean;
  containsRect(rect: Rectangle): boolean;
  intersects(other: Rectangle): boolean;
  intersection(other: Rectangle): Rectangle | null;
  union(other: Rectangle): Rectangle;
  expand(amount: number | Vector2): Rectangle;
  scale(factor: number | Vector2): Rectangle;
  translate(offset: Vector2): Rectangle;
  clone(): Rectangle;
  equals(other: Rectangle): boolean;
  toCssRect(): Partial<JSX.CSSProperties>;
  alignToTarget(
    target: Rectangle,
    opts: { x?: 'left' | 'center' | 'right'; y: 'top' | 'center' | 'bottom' }
  ): Rectangle;
};

const rectangleMethods = {
  containsPoint(this: Rectangle, point: Vector2): boolean {
    return (
      point.x >= this.position.x &&
      point.x <= this.position.x + this.size.x &&
      point.y >= this.position.y &&
      point.y <= this.position.y + this.size.y
    );
  },

  containsRect(this: Rectangle, other: Rectangle): boolean {
    return (
      other.position.x >= this.position.x &&
      other.position.x + other.size.x <= this.position.x + this.size.x &&
      other.position.y >= this.position.y &&
      other.position.y + other.size.y <= this.position.y + this.size.y
    );
  },

  intersects(this: Rectangle, other: Rectangle): boolean {
    return !(
      other.position.x > this.position.x + this.size.x ||
      other.position.x + other.size.x < this.position.x ||
      other.position.y > this.position.y + this.size.y ||
      other.position.y + other.size.y < this.position.y
    );
  },

  intersection(this: Rectangle, other: Rectangle): Rectangle | null {
    const x1 = Math.max(this.position.x, other.position.x);
    const y1 = Math.max(this.position.y, other.position.y);
    const x2 = Math.min(
      this.position.x + this.size.x,
      other.position.x + other.size.x
    );
    const y2 = Math.min(
      this.position.y + this.size.y,
      other.position.y + other.size.y
    );

    if (x1 >= x2 || y1 >= y2) return null;

    return rect(vec2(x1, y1), vec2(x2 - x1, y2 - y1));
  },

  union(this: Rectangle, other: Rectangle): Rectangle {
    const x1 = Math.min(this.position.x, other.position.x);
    const y1 = Math.min(this.position.y, other.position.y);
    const x2 = Math.max(
      this.position.x + this.size.x,
      other.position.x + other.size.x
    );
    const y2 = Math.max(
      this.position.y + this.size.y,
      other.position.y + other.size.y
    );

    return rect(vec2(x1, y1), vec2(x2 - x1, y2 - y1));
  },

  expand(this: Rectangle, amount: number | Vector2): Rectangle {
    const expansion =
      typeof amount === 'number' ? vec2(amount, amount) : amount;
    return rect(
      this.position.subtract(expansion.multiply(0.5)),
      this.size.add(expansion)
    );
  },

  scale(this: Rectangle, factor: number | Vector2): Rectangle {
    const scaleFactor =
      typeof factor === 'number' ? vec2(factor, factor) : factor;
    return rect(this.position, this.size.multiply(scaleFactor));
  },

  translate(this: Rectangle, offset: Vector2): Rectangle {
    return rect(this.position.add(offset), this.size);
  },

  clone(this: Rectangle): Rectangle {
    return rect(this.position.clone(), this.size.clone());
  },

  equals(this: Rectangle, other: Rectangle): boolean {
    return this.position.equals(other.position) && this.size.equals(other.size);
  },

  toString(this: Rectangle): string {
    return `rect(${this.position.toString()}, ${this.size.toString()})`;
  },

  toCssRect(this: Rectangle): Partial<JSX.CSSProperties> {
    const x = this.size.x > 0 ? this.position.x : this.position.x + this.size.x;
    const y = this.size.y > 0 ? this.position.y : this.position.y + this.size.y;
    return {
      transform: `translate(${x}px, ${y}px)`,
      width: `${Math.abs(this.size.x)}px`,
      height: `${Math.abs(this.size.y)}px`,
    };
  },

  alignToTarget(
    target: Rectangle,
    opts: { x?: 'left' | 'center' | 'right'; y: 'top' | 'center' | 'bottom' }
  ) {
    let x = this.x;
    let y = this.y;

    switch (opts.x) {
      case 'left':
        x = target.x;
        break;
      case 'center':
        x = target.x + target.w / 2 - this.w / 2;
        break;
      case 'right':
        x = target.x + (target.w - this.w);
        break;
    }
    switch (opts.y) {
      case 'top':
        y = target.y;
        break;
      case 'center':
        y = target.y + target.h / 2 - this.h / 2;
        break;
      case 'bottom':
        y = target.y + (target.h - this.h);
        break;
    }
    return Rect.fromParams({ x, y, w: this.w, h: this.h });
  },
};

const rectangleHandler: ProxyHandler<Rectangle> = {
  get(target, prop) {
    if (prop === 'x') return target.position.x;
    if (prop === 'y') return target.position.y;
    if (prop === 'w') return target.size.x;
    if (prop === 'h') return target.size.y;
    if (prop === 'width') return target.size.x;
    if (prop === 'height') return target.size.y;
    if (prop === 'left') return target.position.x;
    if (prop === 'right') return target.position.x + target.size.x;
    if (prop === 'top') return target.position.y;
    if (prop === 'bottom') return target.position.y + target.size.y;
    if (prop === 'center')
      return vec2(
        target.position.x + target.size.x / 2,
        target.position.y + target.size.y / 2
      );
    if (prop in rectangleMethods)
      return rectangleMethods[prop as keyof typeof rectangleMethods];
    return target[prop as keyof Rectangle];
  },
};

/**
 * Creates a new Rectangle instance.
 * @param position The position vector of the rectangle's top-left corner.
 * @param size The size vector of the rectangle (width and height).
 * @returns A new Rectangle instance.
 */
export function rect(position: Vector2, size: Vector2): Rectangle {
  return new Proxy({ position, size } as Rectangle, rectangleHandler);
}

// Helper constants and functions
export const Rect = {
  fromPoints(point1: Vector2, point2: Vector2): Rectangle {
    const minX = Math.min(point1.x, point2.x);
    const minY = Math.min(point1.y, point2.y);
    const maxX = Math.max(point1.x, point2.x);
    const maxY = Math.max(point1.y, point2.y);

    return rect(vec2(minX, minY), vec2(maxX - minX, maxY - minY));
  },

  fromCenter(center: Vector2, size: Vector2): Rectangle {
    const halfSize = size.multiply(0.5);
    return rect(center.subtract(halfSize), size);
  },

  boundingRect(rectangles: Rectangle[] | CanvasNode[]): Rectangle {
    const min = vec2(Infinity, Infinity);
    const max = vec2(-Infinity, -Infinity);
    for (const rect of rectangles) {
      let xVal = rect.x;
      let yVal = rect.y;
      let width = rect.width;
      let height = rect.height;
      // apply the manual scale from pencil node
      if ('wScale' in rect) {
        width *= (rect as PencilNode).wScale;
      }
      if ('hScale' in rect) {
        height *= (rect as PencilNode).hScale;
      }

      min.x = Math.min(min.x, xVal, xVal + width);
      min.y = Math.min(min.y, yVal, yVal + height);
      max.x = Math.max(max.x, xVal, xVal + width);
      max.y = Math.max(max.y, yVal, yVal + height);
    }
    return Rect.fromPoints(min, max);
  },

  fromParams(
    params:
      | { x: number; y: number; w: number; h: number }
      | { x: number; y: number; width: number; height: number }
  ): Rectangle {
    if ('w' in params) {
      return rect(vec2(params.x, params.y), vec2(params.w, params.h));
    }
    return rect(vec2(params.x, params.y), vec2(params.width, params.height));
  },

  fromCanvasNode(node: CanvasNode): Rectangle {
    if ('coords' in node)
      return rect(
        vec2(node.x, node.y),
        vec2(node.width * node.wScale, node.height * node.hScale)
      );
    return rect(vec2(node.x, node.y), vec2(node.width, node.height));
  },

  /**
   * Caluclate a new rectangle from a user scale operation as defined by an Anchor type and
   * a canvas-space pointer position.
   * @param rect The rectangle to scale.
   * @param anchor The anchor point of the scale operation.
   * @param point The position of the mouse pointer in canvas space.
   * @returns A new rectangle with the new scale.
   */
  rescaleFromAnchorToPoint(
    rect: Rectangle,
    anchor: Anchor,
    point: Vector2,
    proportional?: boolean,
    centered?: boolean
  ): Rectangle {
    let { x, y, w, h } = rect;

    switch (anchor) {
      case Edges.Top:
        h = rect.h + rect.y - point.y;
        break;
      case Edges.Right:
        w = point.x - rect.x;
        break;
      case Edges.Bottom:
        h = point.y - rect.y;
        break;
      case Edges.Left:
        w = rect.w + rect.x - point.x;
        break;
      case Corners.TopLeft:
        w = rect.w + rect.x - point.x;
        h = rect.h + rect.y - point.y;
        break;
      case Corners.TopRight:
        h = rect.h + rect.y - point.y;
        w = point.x - rect.x;
        break;
      case Corners.BottomRight:
        w = point.x - rect.x;
        h = point.y - rect.y;
        break;
      case Corners.BottomLeft:
        w = rect.w + rect.x - point.x;
        h = point.y - rect.y;
        break;
    }

    let wRatio = w / rect.w;
    let hRatio = h / rect.h;

    // Enforce ratio if rescale is proportional
    if (proportional && (wRatio !== 1 || hRatio !== 1)) {
      // Use the smaller of the two ratios
      if (wRatio === 1 || (hRatio !== 1 && wRatio > hRatio)) {
        wRatio = hRatio;
        w = rect.w * hRatio;
      } else if (hRatio === 1 || (wRatio !== 1 && hRatio > wRatio)) {
        hRatio = wRatio;
        h = rect.h * wRatio;
      }
    }
    // Double scaling if centered, so edge/corner stays under cursor
    if (centered) {
      w = w + (w - rect.w);
      h = h + (h - rect.h);
    }

    // Set position depending on anchor and if rescale is centered
    let transformedRect = Rect.fromParams({ x, y, w, h });

    if (centered) {
      transformedRect = transformedRect.alignToTarget(rect, {
        x: 'center',
        y: 'center',
      });
    } else {
      switch (anchor) {
        case Edges.Top:
          transformedRect = transformedRect.alignToTarget(rect, {
            x: 'center',
            y: 'bottom',
          });
          break;
        case Edges.Right:
          transformedRect = transformedRect.alignToTarget(rect, {
            x: 'left',
            y: 'center',
          });
          break;
        case Edges.Bottom:
          transformedRect = transformedRect.alignToTarget(rect, {
            x: 'center',
            y: 'top',
          });
          break;
        case Edges.Left:
          transformedRect = transformedRect.alignToTarget(rect, {
            x: 'right',
            y: 'center',
          });
          break;
        case Corners.TopLeft:
          transformedRect = transformedRect.alignToTarget(rect, {
            x: 'right',
            y: 'bottom',
          });
          break;
        case Corners.TopRight:
          transformedRect = transformedRect.alignToTarget(rect, {
            x: 'left',
            y: 'bottom',
          });
          break;
        case Corners.BottomRight:
          transformedRect = transformedRect.alignToTarget(rect, {
            x: 'left',
            y: 'top',
          });
          break;
        case Corners.BottomLeft:
          transformedRect = transformedRect.alignToTarget(rect, {
            x: 'right',
            y: 'top',
          });
          break;
      }
    }

    return transformedRect;
  },

  calculateRatioRectangle(inner: Rectangle, outer: Rectangle): Rectangle {
    // TODO: (seamus) Diabling this check for now. Should add epsilon tolerances to
    // many of the vector and rectangle operation.
    // if (!outer.containsRect(inner)) {
    //   throw new Error(
    //     'calulateRatioRectangle: inner rectangle must be contained within outer: inner = ' +
    //       inner.toString() +
    //       ' outer = ' +
    //       outer.toString()
    //   );
    // }

    return Rect.fromParams({
      x: (inner.x - outer.x) / outer.w,
      y: (inner.y - outer.y) / outer.h,
      w: inner.w / outer.w,
      h: inner.h / outer.h,
    });
  },

  applyRatioRectangle(inner: Rectangle, outer: Rectangle): Rectangle {
    return Rect.fromParams({
      x: inner.x * outer.w + outer.x,
      y: inner.y * outer.h + outer.y,
      w: inner.w * outer.w,
      h: inner.h * outer.h,
    });
  },

  intersectLineSegment(
    rect: Rectangle,
    start: Vector2,
    end: Vector2
  ): Vector2[] {
    const intersections: Vector2[] = [];

    const edges = [
      { start: vec2(rect.left, rect.top), end: vec2(rect.right, rect.top) },
      { start: vec2(rect.right, rect.top), end: vec2(rect.right, rect.bottom) },
      {
        start: vec2(rect.right, rect.bottom),
        end: vec2(rect.left, rect.bottom),
      },
      { start: vec2(rect.left, rect.bottom), end: vec2(rect.left, rect.top) },
    ];

    edges.forEach((edge) => {
      const intersection = lineSegmentIntersection(
        start,
        end,
        edge.start,
        edge.end
      );
      if (intersection) intersections.push(intersection);
    });

    return intersections;
  },

  centerPointOfEdge(rect: Rectangle | CanvasNode, edge: Edge): Vector2 {
    const { x, y, width, height } = rect;
    const point = vec2(x + width / 2, y + height / 2);
    if (edge === 'top') point.y = y;
    if (edge === 'right') point.x = x + width;
    if (edge === 'bottom') point.y = y + height;
    if (edge === 'left') point.x = x;
    return point;
  },

  checkPencilIntersection(node: PencilNode, rect: Rectangle): boolean {
    const { x, y, width, height, coords, wScale, hScale } = node;

    const pencilRect = Rect.fromParams({
      x,
      y,
      w: width * wScale,
      h: height * hScale,
    });

    // The selection box can either contain the entire penicl or intersect
    // one or more of the segments.
    if (rect.containsRect(pencilRect)) return true;

    // Cannot intersect a segment if you don't intersect the bounding rect.
    if (!pencilRect.intersects(rect)) return false;

    for (let i = 0; i < coords.length - 1; i++) {
      const start = vec2(x + coords[i][0] * wScale, y + coords[i][1] * hScale);
      const end = vec2(
        x + coords[i + 1][0] * wScale,
        y + coords[i + 1][1] * hScale
      );
      if (Rect.intersectLineSegment(rect, start, end).length > 0) {
        return true;
      }
    }
    return false;
  },
};
