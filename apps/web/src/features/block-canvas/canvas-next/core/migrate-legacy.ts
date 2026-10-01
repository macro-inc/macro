import {
  type Appearance,
  type ConnectorEndpoint,
  freezeDocument,
  type GraphicsItem,
  type ShapeItem,
  sortKeysBetween,
  translation,
} from '@macro-inc/graphics';
import { match } from 'ts-pattern';
import {
  type Canvas,
  type CanvasEntityStyle,
  CanvasSchema,
  type EdgeEnd,
} from '../../model/CanvasModel';
import { CANVAS_VERSION, type CanvasFile, isRecord } from './document-format';
import {
  plainRichText,
  validCanvasText,
  validCanvasTextDocument,
} from './text-codec';

type LegacyNode = NonNullable<Canvas['nodes']>[number];
type LegacyEdge = NonNullable<Canvas['edges']>[number];
type LegacyGroup = NonNullable<Canvas['groups']>[number];
type Placement = { parentId: string; sortKey: string };
export type LegacyTextCodec = (markdown: string) => string;

function appearance(
  style: CanvasEntityStyle | undefined,
  shape = false
): Appearance {
  const fill = style?.fillColor ?? '#e5e7eb';
  // The legacy renderer replaces the fill alpha with 80%, including 8-digit hex.
  const hex =
    fill.length === 4
      ? fill
          .slice(1)
          .split('')
          .map((c) => c + c)
          .join('')
      : fill.slice(1, 7);
  return {
    fill: shape && fill !== 'transparent' ? `#${hex}cc` : 'transparent',
    stroke: style?.strokeColor ?? '#374151',
    strokeWidth: style?.strokeWidth ?? 2,
    opacity: style?.opacity ?? 1,
    cornerRadius: style?.cornerRadius ?? 0,
  };
}

function migrateNode(
  node: LegacyNode,
  placement: Placement,
  text: LegacyTextCodec,
  notes: Set<string>
): GraphicsItem {
  const base = {
    id: node.id,
    placement,
    transform: translation(node.x, node.y),
    appearance: appearance(node.style),
  };
  const box = {
    width: Math.max(1, node.width),
    height: Math.max(1, node.height),
  };
  return match(node)
    .with(
      { type: 'shape' },
      (node): ShapeItem<'rectangle' | 'ellipse'> => ({
        ...base,
        type: node.shape,
        appearance: {
          ...appearance(node.style, true),
          cornerRadius:
            (node.style?.cornerRadius ?? 0) >= 100
              ? Math.min(box.width, box.height) / 2
              : (node.style?.cornerRadius ?? 0),
        },
        geometry: {
          ...box,
          ...(node.label
            ? {
                label: {
                  content: plainRichText(node.label, 'center'),
                  fontSize: node.style?.textSize ?? 12,
                  fontFamily: 'sans',
                  height: (node.style?.textSize ?? 12) * 1.35,
                },
              }
            : {}),
        },
      })
    )
    .with({ type: 'text' }, (node): ShapeItem<'text'> => {
      const content = text(node.text);
      if (!validCanvasText(content))
        throw new Error(`Text ${node.id} could not be migrated`);
      return {
        ...base,
        type: 'text',
        geometry: {
          ...box,
          content,
          fontSize: node.style?.textSize ?? 24,
          fontFamily: 'sans',
          autoWidth: node.followTextWidth ?? false,
        },
      };
    })
    .with({ type: 'pencil' }, (node): ShapeItem<'pencil'> => {
      notes.add(
        'Pencil strokes use the new brush renderer; their original samples are retained in the migration source.'
      );
      return {
        ...base,
        type: 'pencil',
        geometry: {
          points: node.coords.map(
            ([x, y]) => [x * node.wScale, y * node.hScale, 0.5] as const
          ),
          simulatePressure: false,
        },
      };
    })
    .with(
      { type: 'image' },
      { type: 'video' },
      (node): ShapeItem<'image' | 'video'> => {
        if (node.status === 'loading')
          throw new Error(`Media ${node.id} has no saved source yet`);
        return {
          ...base,
          type: node.type,
          appearance: {
            ...base.appearance,
            stroke:
              node.style?.fillColor === 'transparent'
                ? 'transparent'
                : (node.style?.strokeColor ?? 'transparent'),
          },
          transform: [
            node.flipX ? -1 : 1,
            0,
            0,
            node.flipY ? -1 : 1,
            node.x + (node.flipX ? box.width : 0),
            node.y + (node.flipY ? box.height : 0),
          ],
          geometry: {
            ...box,
            name: node.type === 'image' ? 'Image' : 'Video',
            source: {
              type: node.status === 'static' ? 'static' : 'document',
              id: node.uuid,
            },
          },
        };
      }
    )
    .with({ type: 'entitymention' }, (node): ShapeItem<'document'> => {
      if (node.entityType !== 'document' || node.subpath)
        throw new Error(
          `Reference ${node.id} requires the legacy editor (${node.entityType}${node.subpath ? ', subpath' : ''})`
        );
      // Metadata is resolved by the host's document preview, not persisted guesses.
      return {
        ...base,
        type: 'document',
        geometry: {
          ...box,
          documentId: node.file,
          name: 'Document',
          fileType: 'unknown',
        },
      };
    })
    .with({ type: 'link' }, (): never => {
      throw new Error(`Link ${node.id} requires the legacy editor`);
    })
    .exhaustive();
}

function legacyParents(
  nodes: LegacyNode[],
  edges: LegacyEdge[],
  groups: LegacyGroup[],
  ids: Set<string>,
  byGroup: Map<string, LegacyGroup>
) {
  const parents = new Map<string, string>();
  for (const group of groups) {
    for (const id of [
      ...(group.childNodes ?? []),
      ...(group.childEdges ?? []),
    ]) {
      if (!ids.has(id) || byGroup.has(id))
        throw new Error(`Invalid member ${id} in group ${group.id}`);
      const previous = parents.get(id);
      if (previous && previous !== group.id)
        throw new Error(`Conflicting membership for ${id}`);
      parents.set(id, group.id);
    }
  }
  for (const item of [...nodes, ...edges]) {
    if (!item.groupId) continue;
    if (
      !byGroup.has(item.groupId) ||
      (parents.has(item.id) && parents.get(item.id) !== item.groupId)
    )
      throw new Error(`Invalid group for ${item.id}`);
    parents.set(item.id, item.groupId);
  }
  return parents;
}

function legacyLayout(canvas: Canvas) {
  const nodes = canvas.nodes ?? [],
    edges = canvas.edges ?? [],
    groups = canvas.groups ?? [];
  const all = [...nodes, ...edges, ...groups];
  const ids = new Set<string>();
  for (const item of all) {
    if (!item.id || ids.has(item.id))
      throw new Error(`Duplicate or empty canvas id: ${item.id}`);
    ids.add(item.id);
  }
  let rootId = 'scene-root';
  while (ids.has(rootId)) rootId = `_${rootId}`;
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const byGroup = new Map(groups.map((g) => [g.id, g]));
  const parents = legacyParents(nodes, edges, groups, ids, byGroup);
  const order = (item: LegacyNode | LegacyEdge): [number, number] => {
    if (
      'from' in item &&
      (item.from.type === 'connected' || item.to.type === 'connected')
    ) {
      const targets = [item.from, item.to].flatMap((end) => {
        if (end.type === 'free') return [];
        const target = byNode.get(end.node);
        if (!target) throw new Error(`Missing connector target ${end.node}`);
        return [target];
      });
      return [
        Math.max(0, ...targets.map((n) => n.layer)),
        Math.max(...targets.map((n) => n.sortOrder)) + 0.5,
      ];
    }
    const group = byGroup.get(parents.get(item.id) ?? '');
    return group
      ? [group.layer, group.sortOrder + item.sortOrder / 1000]
      : [item.layer, item.sortOrder];
  };
  const ordered = [...nodes, ...edges].sort((a, b) => {
    const x = order(a),
      y = order(b);
    return x[0] - y[0] || x[1] - y[1];
  });
  const rootOrder: string[] = [],
    memberOrder = new Map<string, string[]>();
  let previous: string | undefined;
  for (const item of ordered) {
    const parent = parents.get(item.id);
    const root = parent ?? item.id;
    if (root !== previous) {
      if (rootOrder.includes(root))
        throw new Error('Interleaved group layers require the legacy editor');
      rootOrder.push(root);
      previous = root;
    }
    if (parent)
      memberOrder.set(parent, [...(memberOrder.get(parent) ?? []), item.id]);
  }
  for (const group of groups)
    if (!rootOrder.includes(group.id)) rootOrder.push(group.id);
  const placements = new Map<string, Placement>();
  for (const [parentId, siblings] of [[rootId, rootOrder], ...memberOrder] as [
    string,
    string[],
  ][]) {
    const keys = sortKeysBetween(null, null, siblings.length);
    siblings.forEach((id, i) =>
      placements.set(id, { parentId, sortKey: keys[i]! })
    );
  }
  return { rootId, placements, byNode };
}

function migrateEdges(
  edges: LegacyEdge[],
  placements: Map<string, Placement>,
  byNode: Map<string, LegacyNode>
): GraphicsItem[] {
  const items: GraphicsItem[] = [];
  const endpoint = (end: EdgeEnd): ConnectorEndpoint => {
    if (end.type === 'free') return { point: { x: end.x, y: end.y } };
    const node = byNode.get(end.node);
    if (!node) throw new Error(`Missing connector target ${end.node}`);
    const point = match(end.side)
      .with('top', () => ({ x: node.x + node.width / 2, y: node.y }))
      .with('bottom', () => ({
        x: node.x + node.width / 2,
        y: node.y + node.height,
      }))
      .with('left', () => ({ x: node.x, y: node.y + node.height / 2 }))
      .with('right', () => ({
        x: node.x + node.width,
        y: node.y + node.height / 2,
      }))
      .exhaustive();
    // Legacy media flips only its pixels. In graphics the flip is the item's
    // transform, so compensate to retain the endpoint's visual side.
    let anchor = end.side;
    if (node.type === 'image' || node.type === 'video') {
      if (node.flipX && (anchor === 'left' || anchor === 'right'))
        anchor = anchor === 'left' ? 'right' : 'left';
      if (node.flipY && (anchor === 'top' || anchor === 'bottom'))
        anchor = anchor === 'top' ? 'bottom' : 'top';
    }
    return { point, binding: { targetId: end.node, anchor } };
  };
  const heads = [
    'none',
    'arrow',
    'arrow-filled',
    'circle',
    'circle-small',
  ] as const;
  const routes = ['straight', 'stepped', 'smooth'] as const;
  for (const edge of edges) {
    if (edge.label)
      throw new Error(`Connector label ${edge.id} requires the legacy editor`);
    const startHead = heads[edge.style?.fromEndStyle ?? 0],
      endHead = heads[edge.style?.toEndStyle ?? 0],
      route = routes[edge.style?.connectionStyle ?? 0];
    if (!startHead || !endHead || !route)
      throw new Error(`Unsupported connector style ${edge.id}`);
    items.push({
      id: edge.id,
      type: 'connector',
      placement: placements.get(edge.id)!,
      transform: translation(0, 0),
      appearance: appearance(edge.style),
      geometry: {
        start: endpoint(edge.from),
        end: endpoint(edge.to),
        route,
        startHead,
        endHead,
      },
    });
  }
  return items;
}

/** One-way migration at the application boundary. Never mutate the source or
 * discard an unsupported record. Callers keep the legacy editor available on error. */
export function migrateLegacyCanvas(
  source: unknown,
  text: LegacyTextCodec
): CanvasFile {
  if (
    !isRecord(source) ||
    (source.version !== undefined && source.version !== 1)
  )
    throw new Error('Invalid legacy canvas');
  if (
    !['nodes', 'edges', 'groups'].some((key) => key in source) &&
    Object.keys(source).some((key) => key !== 'version')
  )
    throw new Error('Unrecognized legacy canvas');
  const canvas = CanvasSchema.parse(structuredClone(source));
  const nodes = canvas.nodes ?? [],
    edges = canvas.edges ?? [],
    groups = canvas.groups ?? [];
  const { rootId, placements, byNode } = legacyLayout(canvas);
  const notes = new Set<string>();
  const items: GraphicsItem[] = groups.map((g) => ({
    id: g.id,
    type: 'group',
    placement: placements.get(g.id)!,
    transform: translation(0, 0),
  }));
  items.push(
    ...nodes.map((node) =>
      migrateNode(node, placements.get(node.id)!, text, notes)
    )
  );
  items.push(...migrateEdges(edges, placements, byNode));
  const document = freezeDocument({
    rootId,
    items: Object.fromEntries([
      [rootId, { id: rootId, type: 'surface' }],
      ...items.map((item) => [item.id, item]),
    ]),
  });
  if (!validCanvasTextDocument(document))
    throw new Error('Canvas text requires the legacy editor');
  return {
    version: CANVAS_VERSION,
    document,
    legacy: { version: 1, source: structuredClone(source), notes: [...notes] },
  };
}
