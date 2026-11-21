import ArrowUpRight from '@icon/system/regular/arrow-up-right.svg';
import Circle from '@icon/system/regular/circle.svg';
import Cursor from '@icon/system/regular/cursor.svg';
import Eraser from '@icon/system/regular/eraser.svg';
import Hand from '@icon/system/regular/hand.svg';
import LineSegment from '@icon/system/regular/line-segment.svg';
import Pencil from '@icon/system/regular/pencil-simple.svg';
import Rectangle from '@icon/system/regular/rectangle.svg';
import Text from '@icon/system/regular/text-t.svg';
import type { Component } from 'solid-js';
import { ElbowConnectorIcon } from '../../components/connector-style-icon';
import type { CanvasTool } from '../../primitives/create-canvas-state';

type CanvasToolDescription = {
  label: string;
  icon: Component<{ class?: string }>;
  /** The key that picks the tool, for the tools that have one. */
  key?: string;
};

/**
 * How each tool is named and drawn. A view lists the tools it offers, in its
 * own order; this only describes them.
 */
export const CANVAS_TOOLS = {
  select: { label: 'Select', icon: Cursor, key: 'v' },
  pan: { label: 'Hand', icon: Hand, key: 'h' },
  rectangle: { label: 'Rectangle', icon: Rectangle, key: 'r' },
  ellipse: { label: 'Ellipse', icon: Circle, key: 'o' },
  arrow: { label: 'Arrow', icon: ArrowUpRight, key: 'a' },
  line: { label: 'Line', icon: LineSegment, key: 'l' },
  connector: { label: 'Connector', icon: ElbowConnectorIcon },
  pencil: { label: 'Pencil', icon: Pencil, key: 'p' },
  eraser: { label: 'Eraser', icon: Eraser, key: 'e' },
  text: { label: 'Text', icon: Text, key: 't' },
} satisfies Record<CanvasTool, CanvasToolDescription>;
