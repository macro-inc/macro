import {
  type Appearance,
  type ConnectorAnchor,
  type ConnectorHead,
  type ConnectorRoute,
  freezeDocument,
  type GraphicsDocument,
  type GraphicsFragment,
  type GraphicsItem,
  type GroupItem,
  IDENTITY,
  type Matrix,
  multiply,
  type PencilPoint,
  rotation,
  type ShapeItem,
  type ShapeLabel,
  sortKeysBetween,
  type TextFont,
  translation,
} from '@macro-inc/graphics';
import { plainRichText, type TextAlign } from './text-codec';

/**
 * Excalidraw interop (import only).
 *
 * Converts an Excalidraw `.excalidraw` file or `excalidraw/clipboard` payload
 * into a native graphics {@link GraphicsFragment} so the existing paste command
 * can insert it. Pure and host-free: no DOM, uploads or document mutation.
 *
 * Excalidraw's flat `groupIds` membership is rebuilt into our nested
 * local-transform tree using identity-transform group nodes, so every element
 * keeps its world transform. Container-bound text collapses into the host
 * shape's label. Unsupported elements (images, frames, embeds) are dropped and
 * reported; diamonds are approximated as rectangles.
 */

const SCENE_ROOT = 'scene-root';
const MAX_ELEMENTS = 5000;
const MAX_PENCIL_POINTS = 16384;
/** Excalidraw's `FONT_FAMILY.Cascadia` (code) is our only monospace match. */
const EXCALIDRAW_CODE_FONT = 3;

export type ExcalidrawImport = Readonly<{
  fragment: GraphicsFragment;
  /** Elements placed into the scene. */
  imported: number;
  /** Unsupported elements dropped (images, frames, embeddables, …). */
  skipped: number;
  /** Elements converted with reduced fidelity (diamonds → rectangles). */
  approximated: number;
}>;

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Accepts both the `.excalidraw` file and `excalidraw/clipboard` envelopes. */
export function importExcalidraw(text: string): ExcalidrawImport | undefined {
  if (typeof text !== 'string' || text.length > 2_000_000) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  if (parsed.type !== 'excalidraw' && parsed.type !== 'excalidraw/clipboard')
    return;
  const elements = parsed.elements;
  if (
    !Array.isArray(elements) ||
    elements.length === 0 ||
    elements.length > MAX_ELEMENTS
  )
    return;
  return convertElements(elements);
}

/** Every reconstructed node carries placement; the surface root is added last. */
type SceneNode = ShapeItem | GroupItem;

type Draft = {
  readonly node: SceneNode;
  parentId: string;
  readonly order: number;
};

function convertElements(
  elements: readonly unknown[]
): ExcalidrawImport | undefined {
  const raw = elements
    .filter(isRecord)
    .filter((el) => el.isDeleted !== true && !!str(el.id));

  // Container-bound text becomes the host shape's label, not a standalone item.
  const labelHosts = new Set(
    raw
      .filter(
        (el) =>
          ['rectangle', 'ellipse', 'diamond'].includes(str(el.type)) ||
          (['line', 'arrow'].includes(str(el.type)) &&
            connectorGeometry(el, new Set()) !== undefined)
      )
      .map((el) => str(el.id))
  );
  const boundText = new Map<string, Raw>();
  for (const el of raw) {
    const container = str(el.containerId);
    if (
      el.type === 'text' &&
      labelHosts.has(container) &&
      !boundText.has(container)
    )
      boundText.set(container, el);
  }
  const consumedText = new Set([...boundText.values()].map((el) => str(el.id)));

  // Connectors may only bind to shapes that actually enter the scene.
  const bindable = new Set(
    raw
      .filter((el) => {
        const type = str(el.type);
        if (type === 'text') return !consumedText.has(str(el.id));
        return ['rectangle', 'ellipse', 'diamond'].includes(type);
      })
      .map((el) => str(el.id))
  );

  const chainOf = (el: Raw, id: string): string[] =>
    Array.isArray(el.groupIds)
      ? el.groupIds.filter(
          (g): g is string =>
            typeof g === 'string' && !!g && g !== SCENE_ROOT && g !== id
        )
      : [];

  // Paint order follows the source array; a group ranks with its earliest member.
  const order = new Map<string, number>();
  raw.forEach((el, index) => {
    const id = str(el.id);
    order.set(id, index);
    for (const group of chainOf(el, id))
      order.set(group, Math.min(order.get(group) ?? Infinity, index));
  });

  const drafts = new Map<string, Draft>();
  const groupParent = new Map<string, string>();
  const includedGroups = new Set<string>();
  let imported = 0;
  let skipped = 0;
  let approximated = 0;

  raw.forEach((el, index) => {
    const id = str(el.id);
    if (consumedText.has(id)) return;
    const built = buildNode(el, id, boundText.get(id), bindable);
    if (!built) {
      skipped++;
      return;
    }
    imported++;
    if (built.approximated) approximated++;
    const chain = chainOf(el, id);
    for (let i = 0; i < chain.length; i++) {
      includedGroups.add(chain[i]!);
      if (!groupParent.has(chain[i]!))
        groupParent.set(chain[i]!, chain[i + 1] ?? SCENE_ROOT);
    }
    drafts.set(id, {
      node: built.node,
      parentId: chain[0] ?? SCENE_ROOT,
      order: index,
    });
  });

  if (imported === 0) return;

  // An element id must never collide with a reconstructed group id.
  const groupIds = new Set([...includedGroups].filter((id) => !drafts.has(id)));
  for (const id of groupIds)
    drafts.set(id, {
      node: {
        id,
        type: 'group',
        transform: IDENTITY,
        placement: { parentId: SCENE_ROOT, sortKey: 'a0' },
      },
      parentId: groupParent.get(id) ?? SCENE_ROOT,
      order: order.get(id) ?? 0,
    });

  // Resolve parents to a valid group or the root, then allocate sibling keys.
  const resolveParent = (parentId: string) =>
    parentId === SCENE_ROOT || groupIds.has(parentId) ? parentId : SCENE_ROOT;
  const byParent = new Map<string, string[]>();
  for (const [id, draft] of drafts) {
    const parentId = resolveParent(draft.parentId);
    draft.parentId = parentId;
    (byParent.get(parentId) ?? byParent.set(parentId, []).get(parentId)!).push(
      id
    );
  }

  const items: Record<string, GraphicsItem> = {
    [SCENE_ROOT]: { id: SCENE_ROOT, type: 'surface' },
  };
  for (const [parentId, siblings] of byParent) {
    siblings.sort((a, b) => {
      const left = drafts.get(a)!.order;
      const right = drafts.get(b)!.order;
      return left - right || (a < b ? -1 : a > b ? 1 : 0);
    });
    const keys = sortKeysBetween(null, null, siblings.length);
    siblings.forEach((id, i) => {
      const { node } = drafts.get(id)!;
      items[id] = { ...node, placement: { parentId, sortKey: keys[i]! } };
    });
  }

  const scene: GraphicsDocument = freezeDocument({ rootId: SCENE_ROOT, items });
  return {
    fragment: { kind: 'macro-graphics-fragment', scene },
    imported,
    skipped,
    approximated,
  };
}

type BuiltNode = { node: SceneNode; approximated: boolean };

function buildNode(
  el: Raw,
  id: string,
  label: Raw | undefined,
  bindable: ReadonlySet<string>
): BuiltNode | undefined {
  const transform = elementTransform(el);
  const placement = { parentId: SCENE_ROOT, sortKey: 'a0' };
  switch (str(el.type)) {
    case 'rectangle':
    case 'diamond': {
      const diamond = el.type === 'diamond';
      const width = Math.max(1, num(el.width, 1));
      const height = Math.max(1, num(el.height, 1));
      return {
        node: {
          id,
          type: 'rectangle',
          transform,
          placement,
          geometry: {
            width,
            height,
            ...(label ? { label: labelGeometry(label) } : {}),
          },
          appearance: appearanceOf(el, {
            cornerRadius: diamond ? 0 : cornerRadius(el, width, height),
          }),
        },
        approximated: diamond,
      };
    }
    case 'ellipse': {
      const width = Math.max(1, num(el.width, 1));
      const height = Math.max(1, num(el.height, 1));
      return {
        node: {
          id,
          type: 'ellipse',
          transform,
          placement,
          geometry: {
            width,
            height,
            ...(label ? { label: labelGeometry(label) } : {}),
          },
          appearance: appearanceOf(el),
        },
        approximated: false,
      };
    }
    case 'text': {
      const fontSize = clamp(num(el.fontSize, 20), 1, 10000);
      return {
        node: {
          id,
          type: 'text',
          transform,
          placement,
          geometry: {
            width: Math.max(1, num(el.width, fontSize)),
            height: Math.max(1, num(el.height, fontSize)),
            autoWidth: false,
            fontSize,
            fontFamily: fontOf(el),
            content: plainRichText(str(el.text), alignOf(el)),
          },
          appearance: appearanceOf(el, { fill: false }),
        },
        approximated: false,
      };
    }
    case 'freedraw': {
      const points = freedrawPoints(el);
      if (!points.length) return;
      return {
        node: {
          id,
          type: 'pencil',
          transform,
          placement,
          geometry: {
            points,
            simulatePressure:
              !Array.isArray(el.pressures) || el.pressures.length === 0
                ? el.simulatePressure !== false
                : false,
          },
          appearance: appearanceOf(el, { fill: false }),
        },
        approximated: false,
      };
    }
    case 'line':
    case 'arrow': {
      const geometry = connectorGeometry(el, bindable);
      if (!geometry) return;
      return {
        node: {
          id,
          type: 'connector',
          transform,
          placement,
          geometry: {
            ...geometry,
            ...(label
              ? {
                  label: {
                    ...labelGeometry(label),
                    width: Math.max(1, num(label.width, 240)),
                  },
                }
              : {}),
          },
          appearance: appearanceOf(el, { fill: false }),
        },
        approximated: false,
      };
    }
    default:
      return;
  }
}

/** Excalidraw places the top-left at (x, y) and rotates around the center. */
function elementTransform(el: Raw): Matrix {
  const x = num(el.x);
  const y = num(el.y);
  const width = num(el.width);
  const height = num(el.height);
  const angle = num(el.angle);
  return multiply(
    translation(x + width / 2, y + height / 2),
    multiply(rotation(angle), translation(-width / 2, -height / 2))
  );
}

function appearanceOf(
  el: Raw,
  options: { fill?: boolean; cornerRadius?: number } = {}
): Appearance {
  const background = str(el.backgroundColor, 'transparent');
  const strokeStyle = str(el.strokeStyle);
  return {
    fill:
      options.fill === false || !background || background === 'transparent'
        ? 'transparent'
        : background,
    stroke: str(el.strokeColor, '#1e1e1e') || 'transparent',
    strokeWidth: Math.max(0, num(el.strokeWidth, 2)),
    strokeStyle:
      strokeStyle === 'dashed' || strokeStyle === 'dotted'
        ? strokeStyle
        : 'solid',
    opacity: clamp(num(el.opacity, 100) / 100, 0, 1),
    ...(options.cornerRadius !== undefined
      ? { cornerRadius: Math.max(0, options.cornerRadius) }
      : {}),
  };
}

function cornerRadius(el: Raw, width: number, height: number): number {
  if (!isRecord(el.roundness)) return 0;
  const value = num(el.roundness.value, NaN);
  return Number.isFinite(value)
    ? Math.max(0, value)
    : Math.min(32, Math.min(width, height) * 0.25);
}

function fontOf(el: Raw): TextFont {
  return num(el.fontFamily) === EXCALIDRAW_CODE_FONT ? 'mono' : 'sans';
}

function alignOf(el: Raw): TextAlign {
  const align = str(el.textAlign);
  return align === 'center' || align === 'right' ? align : 'left';
}

function labelGeometry(el: Raw): ShapeLabel {
  const fontSize = clamp(num(el.fontSize, 20), 1, 10000);
  return {
    content: plainRichText(str(el.text), alignOf(el)),
    fontSize,
    fontFamily: fontOf(el),
    height: Math.max(1, num(el.height, fontSize)),
  };
}

function freedrawPoints(el: Raw): PencilPoint[] {
  const points = Array.isArray(el.points) ? el.points : [];
  const pressures = Array.isArray(el.pressures) ? el.pressures : [];
  return points
    .filter(
      (point): point is number[] =>
        Array.isArray(point) &&
        point.length >= 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
    )
    .slice(0, MAX_PENCIL_POINTS)
    .map((point, i) => {
      const pressure = Number.isFinite(pressures[i])
        ? clamp(pressures[i] as number, 0, 1)
        : point.length >= 3 && Number.isFinite(point[2])
          ? clamp(point[2]!, 0, 1)
          : 0.5;
      return [point[0]!, point[1]!, pressure] as PencilPoint;
    });
}

function connectorGeometry(el: Raw, bindable: ReadonlySet<string>) {
  const points = (Array.isArray(el.points) ? el.points : []).filter(
    (point): point is number[] =>
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
  );
  if (points.length < 2) return;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const arrow = el.type === 'arrow';
  const anchor: ConnectorAnchor = 'center';
  const binding = (value: unknown) => {
    const targetId = isRecord(value) ? str(value.elementId) : '';
    return targetId && bindable.has(targetId)
      ? { binding: { targetId, anchor } }
      : {};
  };
  const startBinding = binding(el.startBinding);
  const endBinding = binding(el.endBinding);
  return {
    start: {
      point: { x: first[0]!, y: first[1]! },
      ...startBinding,
    },
    end: { point: { x: last[0]!, y: last[1]! }, ...endBinding },
    route:
      startBinding.binding && endBinding.binding
        ? routeOf(el)
        : ('straight' as const),
    startHead: headOf(el.startArrowhead, 'none'),
    endHead: headOf(el.endArrowhead, arrow ? 'arrow' : 'none'),
  };
}

function routeOf(el: Raw): ConnectorRoute {
  if (el.elbowed === true) return 'stepped';
  if (isRecord(el.roundness)) return 'smooth';
  return 'straight';
}

function headOf(value: unknown, fallback: ConnectorHead): ConnectorHead {
  if (value === null) return 'none';
  if (value === undefined) return fallback;
  switch (value) {
    case 'arrow':
      return 'arrow';
    case 'triangle':
    case 'triangle_outline':
    case 'diamond':
    case 'diamond_outline':
      return 'arrow-filled';
    case 'dot':
    case 'circle':
      return 'circle';
    case 'circle_outline':
      return 'circle-small';
    default:
      return 'arrow';
  }
}
