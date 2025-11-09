import { batch } from 'solid-js';
import { type ReorderOperation, ReorderOperations } from '../constants';
import {
  renderQueue,
  useCanvasEdges,
  useCanvasGroups,
  useCanvasNodes,
} from '../store/canvasData';
import { useCanvasHistory } from './canvasHistory';
import { useSelection } from './selection';

export function useReorder() {
  const history = useCanvasHistory();
  const selection = useSelection();
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();
  const groups = useCanvasGroups();
  const rq = renderQueue();

  return {
    reorder(op: ReorderOperation, autosave: boolean) {
      history.open();

      batch(() => {
        rq.normalize();
        const len = rq.length();
        let sortOffset = 0;
        if (op === ReorderOperations.BringToFront) {
          sortOffset = len + 1;
        } else if (op === ReorderOperations.SendToBack) {
          sortOffset = -len - 1;
        } else if (op === ReorderOperations.Forward) {
          sortOffset = 1.5;
        } else if (op === ReorderOperations.Backward) {
          sortOffset = -1.5;
        }

        const selectedGroups = new Set<string>();

        nodes.batchUpdate(
          () => {
            selection.selectedNodes().forEach((node) => {
              if (node.groupId) {
                selectedGroups.add(node.groupId);
                return;
              }
              nodes.updateNode(node.id, {
                sortOrder: nodes.get(node.id).sortOrder + sortOffset,
              });
            });
          },
          { autosave }
        );

        edges.batchUpdate(
          () => {
            selection.selectedEdges().forEach((edge) => {
              if (edge.groupId) {
                selectedGroups.add(edge.groupId);
                return;
              }
              if (
                edge.from.type === 'connected' ||
                edge.to.type === 'connected'
              ) {
                return;
              }
              edges.updateEdge(edge.id, {
                sortOrder: edges.get(edge.id).sortOrder + sortOffset,
              });
            });
          },
          { autosave }
        );

        groups.batchUpdate(
          () => {
            selectedGroups.forEach((groupId) => {
              groups.update(groupId, {
                sortOrder: groups.get(groupId).sortOrder + sortOffset,
              });
            });
          },
          { autosave }
        );

        rq.normalize();
        history.close();
      });
    },
  };
}
