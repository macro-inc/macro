import type { ThreadPayload } from '@block-pdf/type/comments';
import { v7 as uuid7 } from 'uuid';
import { z } from 'zod';
import { Color, type IColor } from './Color';

const SAME_LINE_UNIT_BUFFER = 0.002;
const ADJACENT_BUFFER = 0.01;

const WHSchema = z.object({
  width: z.number(),
  height: z.number(),
});

export type WH = z.infer<typeof WHSchema>;

export class HighlightRect {
  public top: number;
  public left: number;
  public width: number;
  public height: number;

  constructor(top: number, left: number, width: number, height: number) {
    this.top = top;
    this.left = left;
    this.width = width;
    this.height = height;
  }

  public clone(): HighlightRect {
    return new HighlightRect(this.top, this.left, this.width, this.height);
  }

  public toString(): string {
    return JSON.stringify(
      [this.top, this.left, this.width, this.height].map((num) =>
        parseFloat(num.toFixed(2))
      )
    );
  }

  public static toObject(this_: HighlightRect): IHighlightRect {
    return {
      top: this_.top,
      left: this_.left,
      width: this_.width,
      height: this_.height,
    };
  }

  public static matches(this_: IHighlightRect, other: IHighlightRect): boolean {
    return (
      this_.top === other.top &&
      this_.left === other.left &&
      this_.width === other.width &&
      this_.height === other.height
    );
  }

  public static overlaps(
    this_: IHighlightRect,
    other: IHighlightRect
  ): boolean {
    return (
      HighlightRect.startsWithin(this_, other) ||
      HighlightRect.endsWithin(this_, other) ||
      HighlightRect.startsWithin(other, this_) ||
      HighlightRect.endsWithin(other, this_)
    );
  }

  public static onSameLine(
    this_: IHighlightRect,
    other: IHighlightRect
  ): boolean {
    return Math.abs(this_.top - other.top) <= SAME_LINE_UNIT_BUFFER;
  }

  public static isAdjacent(
    this_: IHighlightRect,
    other: IHighlightRect
  ): boolean {
    return (
      HighlightRect.onSameLine(this_, other) &&
      other.left - HighlightRect.right(this_) <= ADJACENT_BUFFER
    );
  }

  public static startsWithin(
    this_: IHighlightRect,
    other: IHighlightRect
  ): boolean {
    return (
      HighlightRect.onSameLine(this_, other) &&
      other.left <= this_.left &&
      this_.left < other.left + other.width
    );
  }

  public static endsWithin(
    this_: IHighlightRect,
    other: IHighlightRect
  ): boolean {
    const right = HighlightRect.right(this_);
    return (
      HighlightRect.onSameLine(this_, other) &&
      other.left <= right &&
      right < other.left + other.width
    );
  }

  public static right(this_: IHighlightRect): number {
    return this_.left + this_.width;
  }

  public static sortedOrder(r1: IHighlightRect, r2: IHighlightRect): number {
    if (HighlightRect.onSameLine(r1, r2)) {
      return r1.left - r2.left;
    } else {
      return r1.top - r2.top;
    }
  }
}

const HighlightRectSchema = z.object({
  top: z.number(),
  left: z.number(),
  width: z.number(),
  height: z.number(),
});

type IHighlightRect = z.infer<typeof HighlightRectSchema>;

export const HighlightType = {
  HIGHLIGHT: 1,
  UNDERLINE: 2,
  STRIKEOUT: 3,
} as const;

export class Highlight {
  static colors = [
    new Color(255, 255, 255, 0.4), // white
    new Color(0, 0, 0, 0.4), // black
    new Color(255, 0, 0, 0.4), // red
    new Color(253, 186, 116, 0.4), // orange
    new Color(253, 224, 71, 0.4), // yellow
    new Color(0, 255, 0, 0.4), // green
    new Color(94, 234, 212, 0.4), // cyan
    new Color(125, 211, 252, 0.4), // blue
    new Color(165, 180, 252, 0.4), // indigo
    new Color(216, 180, 254, 0.4), // purple
  ];

  public static defaultYellow = Highlight.colors[4];
  public static defaultGreen = new Color(0, 255, 0, 1);
  public static defaultRed = new Color(255, 0, 0, 1);

  public pageNum: number;
  public rects: HighlightRect[];
  public color: Color;
  public type: (typeof HighlightType)[keyof typeof HighlightType];
  public thread: ThreadPayload | null;
  public text: string;
  public pageViewport?: WH;
  public uuid: string;
  public hasTempThread: boolean;
  public owner: string | undefined;

  constructor({
    pageNum,
    rects,
    color,
    type,
    thread,
    text,
    pageViewport,
    uuid,
    owner,
  }: {
    pageNum: number;
    pageViewport?: { height: number; width: number };
    rects: HighlightRect[];
    color?: Color | IColor | null;
    type: (typeof HighlightType)[keyof typeof HighlightType];
    thread: ThreadPayload | null;
    text?: string;
    uuid: string;
    owner?: string;
  }) {
    this.pageNum = pageNum;
    this.rects = rects;

    if (color instanceof Color) {
      this.color = color;
    } else if (color) {
      this.color = new Color(color.red, color.green, color.blue, color.alpha);
    } else {
      this.color = Highlight.defaultYellow;
    }

    this.type = type;
    this.thread = thread;
    this.hasTempThread = false;
    this.text = text ?? '';
    this.pageViewport = pageViewport;
    this.uuid = uuid;
    this.owner = owner;
  }

  public static overlaps(
    this_: Pick<IHighlight, 'pageNum' | 'rects'>,
    other: Pick<IHighlight, 'pageNum' | 'rects'>
  ): boolean {
    if (this_.pageNum === other.pageNum) {
      return this_.rects.some((r1) => {
        return other.rects.some((r2) => HighlightRect.overlaps(r1, r2));
      });
    }

    return false;
  }

  public static toObject(this_: Highlight): IHighlight {
    return {
      pageNum: this_.pageNum,
      rects: this_.rects.map(HighlightRect.toObject),
      color: Color.toObject(this_.color),
      type: this_.type,
      thread: this_.thread,
      text: this_.text,
      pageViewport: this_.pageViewport,
      uuid: this_.uuid ?? uuid7(),
      hasTempThread: this_.hasTempThread,
      existsOnServer: false,
      owner: this_.owner,
    };
  }
}

export type IHighlight = {
  pageNum: number;
  rects: IHighlightRect[];
  color: IColor;
  type: (typeof HighlightType)[keyof typeof HighlightType];
  thread: ThreadPayload | null;
  text: string;
  pageViewport?: WH;
  uuid: string;
  hasTempThread: boolean;
  existsOnServer: boolean;
  owner?: string;
};
