import {
  type CanvasEdge,
  type CanvasNode,
  EdgeConnectionStyles,
  EdgeEndStyles,
  type EdgeSideType,
} from '@block-canvas/model/CanvasModel';
import {
  useCanvasNodes,
  useCreateEdge,
  useCreateNode,
} from '@block-canvas/store/canvasData';
import { createCallback } from '@solid-primitives/rootless';
import mermaid from 'mermaid';
import { nanoid } from 'nanoid';
import { Rect } from './rectangle';
import { getTailwindColor } from './style';

const FLOWCHART = 'flowchart-v2';

const WRAPPING_WIDTH = 220;
const NODE_SPACING = 40;

export const flowchartSample1 = `flowchart TD

  A[Start] --> B[Initialize]

  B[Initialize] --> C[Input Data]
  C[Input Data] --> D{Data Valid?}

  D{Data Valid?} -- Yes --> E[Process Data]
  E[Process Data] --> F{More Data?}
  F{More Data?} -- Yes --> C[Input Data]
  F{More Data?} -- No --> G[Generate Output]

  D{Data Valid?} -- No --> I[Report Error]
  I[Report Error] --> H[End]

  B[Initialize] --> J[Task 1]
  J[Task 1] --> K[Task 2]
  K[Task 2] --> L[Task 3]
  L[Task 3] --> M[Task 4]
  M[Task 4] --> N[Task 5]
  N[Task 5] --> O[Task 6]
  O[Task 6] --> P[Task 7]
  P[Task 7] --> Q[Task 8]
  Q[Task 8] --> R[Task 9]
  R[Task 9] --> S[Task 10]
  S[Task 10] --> T[End]

  U[Decision] --> V[Decision Point]
  V[Decision Point] --> W{Condition 1}
  W{Condition 1} -- Yes --> X[Option 1]
  X[Option 1] --> Y[End Option 1]
  W{Condition 1} -- No --> Z[Option 2]
  Z[Option 2] --> Y[End Option 2]
  Y[End Option 1] --> U[Decision]

  AA[Loop] --> AB[Loop Start]
  AB[Loop Start] --> AC[Loop Condition]
  AC[Loop Condition] -- Yes --> AD[Loop Task]
  AD[Loop Task] --> AE[Loop End]
  AC[Loop Condition] -- No --> AF[Exit Loop]
  AF[Exit Loop] --> AE[Loop End]
  AE[Loop End] --> AA[Loop]

  AG[Subprocess] --> AH[Start Subprocess]
  AH[Start Subprocess] --> AI[Subprocess Task 1]
  AI[Subprocess Task 1] --> AJ[Subprocess Task 2]
  AJ[Subprocess Task 2] --> AK[Subprocess Task 3]
  AK[Subprocess Task 3] --> AL[End Subprocess]

  A[Start] --> B[Initialize]
  B[Initialize] --> J[Task 1]
  J[Task 1] --> U[Decision]
  U[Decision] --> AA[Loop]
  AA[Loop] --> AG[Subprocess]
  AG[Subprocess] --> J[Task 1]
  AG[Subprocess] --> B[Initialize]`;

type FlowchartVertex = {
  id: string;
  domId: string;
  labelType: string;
  text: string;
  type: string;
  props: { [key: string]: string };
  styles: string[];
  classes: string[];
};

type FlowchartEdge = {
  start: string;
  end: string;
  stroke: string;
  labelType: string;
  text: string;
  type: string;
  props: { [key: string]: string };
  styles: string[];
};

/**
 * Get x, y coordinates from a 2d svg translate string.
 * Example: translate(100, 200)
 * @param translateString - The translate string
 * @returns An object with x and y coordinates
 */
function parseTranslate(translateString: string): { x: number; y: number } {
  const cleaned = translateString.replace(/translate\(|\)/g, '');
  const values = cleaned.split(/[\s,]+/);
  const x = parseFloat(values[0] || '0');
  const y = parseFloat(values[1] || '0');
  return { x, y };
}

/**
 * Get the "hidden" internal diagram connectivity info from the mermaid parser.
 * @param code - The mermaid code to parse
 * @returns An object with the vertices and edges of the flowchart diagram
 */
async function extractDiagramInfo(code: string): Promise<{
  vertices: Map<string, FlowchartVertex>;
  edges: FlowchartEdge[];
}> {
  const { diagramType } = await mermaid.parse(code);
  if (diagramType !== FLOWCHART) {
    throw new Error('Only flowchart-v2 is supported');
  }
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);

  //@ts-ignore - extracting un-exported internal data.
  const vertices = diagram.db.vertices;

  //@ts-ignore - extracting un-exported internal data.
  const edges = diagram.db.edges;

  return { vertices, edges };
}

/**
 * Get a root node that can be used to query the svg.
 */
function getSvgRoot(svg: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('SVG parsing error: ' + parserError.textContent);
  }
  return doc.documentElement;
}

/**
 * Simple heuristic to determine the best connection sides for a given edge.
 */
function getBestConnectionSides(
  from: CanvasNode,
  to: CanvasNode
): { from: EdgeSideType; to: EdgeSideType } {
  const fromRect = Rect.fromCanvasNode(from);
  const toRect = Rect.fromCanvasNode(to);
  const dx = toRect.left - fromRect.left;
  const dy = toRect.top - fromRect.top;

  if (fromRect.bottom < toRect.top && Math.abs(dy) > Math.abs(dx)) {
    return { from: 'bottom', to: 'top' };
  }

  if (fromRect.right < toRect.left && Math.abs(dx) >= Math.abs(dy)) {
    return { from: 'right', to: 'left' };
  }

  if (fromRect.top > toRect.bottom && Math.abs(dy) > Math.abs(dx)) {
    return { from: 'top', to: 'bottom' };
  }

  if (fromRect.left > toRect.right && Math.abs(dx) >= Math.abs(dy)) {
    return { from: 'left', to: 'right' };
  }

  return { from: 'bottom', to: 'top' };
}

function buildCanvasNode(
  vertex: FlowchartVertex,
  node: Node
): CanvasNode | null {
  const fontSize = 12;
  if (node instanceof SVGElement) {
    if (node.classList.contains('node')) {
      const id = node.getAttribute('id') || nanoid(8);
      const label = vertex.text ?? id;
      const { x: outerX, y: outerY } = parseTranslate(
        node.getAttribute('transform') || ''
      );

      const innerRect = node.querySelector('rect') as SVGRectElement | null;
      if (!innerRect) return null;

      let { x: innerX, y: innerY, width, height } = innerRect;
      let x = Number(innerX.baseVal.value) + outerX;
      let y = Number(innerY.baseVal.value) + outerY;

      return {
        id: id,
        type: 'shape',
        shape: 'rectangle',
        label: label ?? id ?? 'NO ID',
        x,
        y,
        width: Number(width.baseVal.value),
        height: Number(height.baseVal.value),
        edges: [],
        style: {
          strokeColor: getTailwindColor('gray-700'),
          fillColor: getTailwindColor('gray-50'),
          strokeWidth: 2,
          opacity: 1,
          textSize: fontSize,
        },
        sortOrder: 0,
        layer: 0,
      };
    }
  }
  return null;
}

function buildCanvasEdge(
  edge: FlowchartEdge,
  vertices: Map<string, FlowchartVertex>,
  ids: Map<string, string>,
  getNode: (id: string) => CanvasNode | null
): Omit<CanvasEdge, 'id'> | null {
  const { start, end } = edge;
  const stardDomId = vertices.get(start)?.domId;
  const endDomId = vertices.get(end)?.domId;
  if (!stardDomId || !endDomId) return null;

  const startNodeId = ids.get(start)!;
  const endNodeId = ids.get(end)!;

  const startNode = getNode(startNodeId);
  const endNode = getNode(endNodeId);
  if (!startNode || !endNode) return null;

  const { from, to } = getBestConnectionSides(startNode, endNode);

  return {
    from: {
      type: 'connected',
      node: startNodeId,
      side: from,
    },
    to: {
      type: 'connected',
      node: endNodeId,
      side: to,
    },
    style: {
      strokeColor: getTailwindColor('gray-700'),
      strokeWidth: 2,
      opacity: 1,
      fromEndStyle: EdgeEndStyles.None,
      toEndStyle: EdgeEndStyles.Arrow,
      connectionStyle: EdgeConnectionStyles.smooth,
    },
    sortOrder: 0,
    layer: 0,
  };
}

export function useRenderMermaid() {
  const createNode = useCreateNode();
  const createEdge = useCreateEdge();
  const { batchUpdate, updateNode, get: getNode } = useCanvasNodes();

  return createCallback(async (code: string) => {
    mermaid.initialize({
      flowchart: {
        curve: 'step',
        wrappingWidth: WRAPPING_WIDTH,
        nodeSpacing: NODE_SPACING,
      },
      fontSize: 12,
    });
    let safeCode = code.replace(/<br>|<br\/>/g, '');

    const { diagramType } = await mermaid.parse(safeCode);
    if (diagramType !== FLOWCHART) {
      throw new Error('Only flowchart-v2 is supported');
    }

    const createdNodes: CanvasNode[] = [];

    // Map from the incoming mermaid ids to the actually used canvas ids.
    const ids = new Map<string, string>();

    const { vertices, edges } = await extractDiagramInfo(safeCode);
    const { svg: svgText } = await mermaid.render(
      'mermaid-to-canvas',
      safeCode
    );
    const svg = getSvgRoot(svgText);

    batchUpdate(
      () => {
        for (const vertex of Array.from(vertices.values())) {
          const svgNode = svg.querySelector(`#${vertex.domId} `);
          if (!svgNode) continue;
          const nodeData = buildCanvasNode(vertex, svgNode);
          if (!nodeData) continue;
          let canvasNode = createNode(nodeData);
          createdNodes.push(canvasNode);
          ids.set(vertex.id, canvasNode.id);
        }

        const boundingRect = Rect.boundingRect(createdNodes);
        const center = boundingRect.center;
        for (const node of createdNodes) {
          updateNode(node.id, {
            x: node.x - center.x,
            y: node.y - center.y,
          });
        }

        for (const edge of edges) {
          const canvasEdge = buildCanvasEdge(edge, vertices, ids, getNode);
          if (canvasEdge) {
            createEdge(canvasEdge);
          }
        }
      },
      { autosave: true }
    );
  });
}
