export function stringResult(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected model string');
  return value;
}

export function numberResult(value: unknown): number {
  if (typeof value !== 'number') throw new Error('expected model number');
  return value;
}

export function booleanResult(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('expected model boolean');
  return value;
}

export function keyResult(value: unknown): string | null {
  return value === null ? null : stringResult(value);
}

export function directionResult(value: unknown): 'ltr' | 'rtl' | null {
  if (value === null || value === 'ltr' || value === 'rtl') return value;
  throw new Error('expected model direction');
}

export function modeResult(value: unknown): 'normal' | 'token' | 'segmented' {
  switch (value) {
    case 0:
      return 'normal';
    case 1:
      return 'token';
    case 2:
      return 'segmented';
    default:
      throw new Error('expected model text mode');
  }
}

import { ElementNode, LexicalNode, RootNode } from './index';
export function nodeResult(value: unknown): LexicalNode {
  if (!(value instanceof LexicalNode)) throw new Error('expected model node');
  return value;
}
export function nodesResult(value: unknown): LexicalNode[] {
  if (!Array.isArray(value)) throw new Error('expected model nodes');
  return value.map(nodeResult);
}
export function isRootOrShadowRoot(node: LexicalNode | null): boolean {
  return (
    node instanceof RootNode ||
    (node instanceof ElementNode && node.isShadowRoot())
  );
}
