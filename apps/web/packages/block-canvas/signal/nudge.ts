import { sharedInstance } from '@block-canvas/util/sharedInstance';
import { batch } from 'solid-js';
import { useCanvasEdges, useCanvasNodes } from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { vec2 } from '../util/vector2';
import { useCanvasHistory } from './canvasHistory';
import { useSelection } from './selection';

export const useNudge = sharedInstance(() => {
  const baseNudgeDistance = 5;
  const { currentScale } = useRenderState();
  const history = useCanvasHistory();
  const selection = useSelection();
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();

  return {
    nudge(direction: string, shift: boolean, autosave: boolean) {
      const nudgeDistance =
        (shift ? baseNudgeDistance * 10 : baseNudgeDistance) / currentScale();

      const modifier = vec2(
        direction === 'right'
          ? nudgeDistance
          : direction === 'left'
            ? -nudgeDistance
            : 0,
        direction === 'down'
          ? nudgeDistance
          : direction === 'up'
            ? -nudgeDistance
            : 0
      );

      history.open();

      batch(() => {
        nodes.batchUpdate(
          () => {
            selection.selectedNodeIds().forEach((nodeId) => {
              const original = nodes.get(nodeId);
              nodes.updateNode(nodeId, {
                x: original.x + modifier.x,
                y: original.y + modifier.y,
              });
            });
          },
          { autosave }
        );

        edges.batchUpdate(
          () => {
            selection.selectedEdgeIds().forEach((edgeId) => {
              const original = edges.get(edgeId);
              edges.updateEdge(edgeId, {
                from:
                  original.from.type === 'free'
                    ? {
                        type: 'free',
                        x: original.from.x + modifier.x,
                        y: original.from.y + modifier.y,
                      }
                    : original.from,
                to:
                  original.to.type === 'free'
                    ? {
                        type: 'free',
                        x: original.to.x + modifier.x,
                        y: original.to.y + modifier.y,
                      }
                    : original.to,
              });
            });
          },
          { autosave }
        );

        history.close();
      });
    },
  };
});
