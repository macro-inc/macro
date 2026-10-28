import {
  IDENTITY,
  inverse,
  type Matrix,
  multiply,
  sameMatrix,
} from '../core/affine';
import { resolveAppearance } from '../core/appearance';
import type {
  GraphicsDocument,
  GraphicsItem,
  ShapeGeometryMap,
  ShapeKind,
} from '../core/model';
import { sortKeysBetween } from '../core/ordering';
import {
  children,
  freezeDocument,
  paintOrder,
  worldMatrix,
} from '../core/scene';
import { canLabel } from '../core/shapes/label';
import { isShape, shapePayload } from '../core/shapes/registry';
import type { CanvasForest, NodeData } from './schema';

export function readScene(forest: CanvasForest, rootId: string) {
  const items: Record<string, GraphicsItem> = {
    [rootId]: { id: rootId, type: 'surface' },
  };
  const frameConflicts: string[] = [];
  function visit(nodes: CanvasForest, parentId: string, parentWorld: Matrix) {
    // Loro owns durable ordering. These keys are a disposable core projection.
    const keys = sortKeysBetween(null, null, nodes.length);
    nodes.forEach((node, index) => {
      const id = node.data.id,
        kind = node.data.kind,
        pose = node.data.pose;
      if (!id || !kind || !pose || Object.hasOwn(items, id))
        throw new Error('Invalid shared scene node');
      const matchingFrame = pose.parentId === parentId;
      const transform = matchingFrame
        ? pose.transform
        : multiply(inverse(parentWorld), pose.world);
      if (!matchingFrame) frameConflicts.push(id);
      const spatial = {
        id,
        transform,
        placement: { parentId, sortKey: keys[index]! },
      };
      if (kind === 'group') items[id] = { ...spatial, type: 'group' };
      else {
        const fill = node.data.fill,
          stroke = node.data.stroke;
        if (!pose.geometry || fill === undefined || stroke === undefined)
          throw new Error('Invalid shared shape');
        items[id] = {
          ...spatial,
          ...shapePayload(
            kind,
            restoreText(
              kind,
              pose.geometry,
              node.data.textContent ?? null,
              node.data.labelStyle ?? null
            )
          ),
          appearance: {
            fill,
            stroke,
            strokeWidth: node.data.strokeWidth ?? 2,
            strokeStyle: node.data.strokeStyle ?? 'solid',
            opacity: node.data.opacity ?? 1,
            cornerRadius: node.data.cornerRadius ?? 0,
          },
        };
      }
      visit(node.children, id, multiply(parentWorld, transform));
    });
  }
  visit(forest, rootId, IDENTITY);
  return { document: freezeDocument({ rootId, items }), frameConflicts };
}

function textContent(node: GraphicsItem | undefined): string | null {
  if (node?.type === 'text') return node.geometry.content;
  return canLabel(node) ? (node.geometry.label?.content ?? null) : null;
}
/** Pose and text use separate map registers, so a move cannot overwrite typing. */
function poseGeometry(node: GraphicsItem | undefined) {
  if (!isShape(node)) return null;
  if (node.type === 'text') return { ...node.geometry, content: '' };
  if (canLabel(node)) {
    const { label: _label, ...box } = node.geometry;
    return box;
  }
  return node.geometry;
}
function restoreText(
  kind: ShapeKind,
  geometry: ShapeGeometryMap[ShapeKind],
  content: string | null,
  labelStyle: NodeData['labelStyle']
) {
  if (kind === 'text') return { ...geometry, content };
  if (kind === 'rectangle' || kind === 'ellipse' || kind === 'connector')
    return content !== null && labelStyle
      ? { ...geometry, label: { ...labelStyle, content } }
      : geometry;
  return geometry;
}

function labelStyle(node: GraphicsItem | undefined): NodeData['labelStyle'] {
  if (!canLabel(node) || !node.geometry.label) return null;
  const { content: _content, ...style } = node.geometry.label;
  return style;
}

/** Build a typed proposal. Mirror owns all generic tree and map operations. */
export function writeScene(
  forest: CanvasForest,
  before: GraphicsDocument,
  next: GraphicsDocument
): CanvasForest {
  if (before.rootId !== next.rootId || next.surface)
    throw new Error('Shared graphics backend supports one unbounded surface');
  const data = new Map<string, NodeData>();
  function collect(nodes: CanvasForest) {
    for (const node of nodes) {
      data.set(node.data.id, node.data);
      collect(node.children);
    }
  }
  collect(forest);
  for (const id of paintOrder(next)) {
    if (before.items[id] && before.items[id]!.type !== next.items[id]!.type)
      throw new Error('Shared node kinds are immutable');
  }
  function project(parent: string): CanvasForest {
    return children(next, parent).map((id) => {
      const node = next.items[id]!,
        old = before.items[id],
        previous = data.get(id);
      if (node.type === 'surface')
        throw new Error('Surface cannot be a tree node');
      const geometry = poseGeometry(node);
      const poseChanged =
        !previous ||
        !old ||
        old.type === 'surface' ||
        old.placement.parentId !== node.placement.parentId ||
        !sameMatrix(old.transform, node.transform) ||
        JSON.stringify(poseGeometry(old)) !== JSON.stringify(geometry);
      const appearance = isShape(node)
        ? resolveAppearance(node.appearance)
        : {
            fill: 'transparent',
            stroke: 'transparent',
            strokeWidth: 2,
            strokeStyle: 'solid' as const,
            opacity: 1,
            cornerRadius: 0,
          };
      const nextData: NodeData = previous
        ? { ...previous }
        : {
            id,
            kind: node.type,
            pose: {
              parentId: node.placement.parentId,
              transform: node.transform,
              world: worldMatrix(next, id),
              geometry,
            },
            textContent: textContent(node),
            labelStyle: labelStyle(node),
            ...appearance,
          };
      if (poseChanged)
        nextData.pose = {
          parentId: node.placement.parentId,
          transform: node.transform,
          world: worldMatrix(next, id),
          geometry,
        };
      nextData.textContent = textContent(node);
      nextData.labelStyle = labelStyle(node);
      if (isShape(node)) {
        const oldAppearance = isShape(old)
          ? resolveAppearance(old.appearance)
          : undefined;
        if (!oldAppearance || oldAppearance.fill !== appearance.fill)
          nextData.fill = appearance.fill;
        if (!oldAppearance || oldAppearance.stroke !== appearance.stroke)
          nextData.stroke = appearance.stroke;
        if (
          !oldAppearance ||
          oldAppearance.strokeStyle !== appearance.strokeStyle
        )
          nextData.strokeStyle = appearance.strokeStyle;
        for (const key of ['strokeWidth', 'opacity', 'cornerRadius'] as const) {
          if (!oldAppearance || oldAppearance[key] !== appearance[key])
            nextData[key] = appearance[key];
        }
      }
      return { data: nextData, children: project(id) };
    });
  }
  return project(next.rootId);
}
