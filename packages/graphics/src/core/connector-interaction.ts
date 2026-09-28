import { IDENTITY, inverse, transformPoint } from './affine';
import type { ConnectorStyle } from './connector-commands';
import {
  type ConnectorPort,
  type ConnectorTarget,
  connectorTargetAt,
  resolveConnector,
} from './connectors';
import type { Appearance, GraphicsDocument, Point, ShapeItem } from './model';
import { keysAt } from './ordering';
import { children, worldMatrix } from './scene';
import type { ConnectorEndpoint } from './shapes/connector';

export type ConnectorGesture = Readonly<{
  item: ShapeItem<'connector'>;
  endpoint: 'start' | 'end';
  dropTarget?: ConnectorPort;
  creating: boolean;
}>;
export function createConnectorInteraction(host: {
  getDocument(): GraphicsDocument;
  commit(item: ShapeItem<'connector'>): void;
  onChange(): void;
}) {
  let gesture: ConnectorGesture | undefined;
  let target: ConnectorTarget | undefined;
  const emit = () => host.onChange();
  const cancel = () => {
    gesture = undefined;
    target = undefined;
    emit();
  };
  const previewDocument = (): GraphicsDocument => {
    const doc = host.getDocument();
    return gesture
      ? { ...doc, items: { ...doc.items, [gesture.item.id]: gesture.item } }
      : doc;
  };
  function update(point: Point, tolerance: number, shift = false) {
    if (!gesture || ![point.x, point.y].every(Number.isFinite)) return;
    const document = previewDocument(),
      item = gesture.item,
      other = gesture.endpoint === 'start' ? 'end' : 'start';
    const world = worldMatrix(document, item.id);
    target = connectorTargetAt(document, point, tolerance);
    const port = target?.active;
    const fixed = transformPoint(
      world,
      resolveConnector(document, item).geometry[other].point
    );
    if (shift && !port) {
      const dx = point.x - fixed.x,
        dy = point.y - fixed.y,
        distance = Math.hypot(dx, dy);
      const angle =
        (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
      point = {
        x: fixed.x + Math.cos(angle) * distance,
        y: fixed.y + Math.sin(angle) * distance,
      };
    }
    const end: ConnectorEndpoint = {
      point: transformPoint(inverse(world), port?.point ?? point),
      ...(port
        ? { binding: { targetId: port.targetId, anchor: port.anchor } }
        : {}),
    };
    gesture = {
      ...gesture,
      dropTarget: port,
      item: {
        ...item,
        geometry: { ...item.geometry, [gesture.endpoint]: end },
      },
    };
    emit();
  }
  return {
    getState: () => gesture,
    getTarget: () => target,
    hover(point: Point, tolerance: number) {
      target = connectorTargetAt(previewDocument(), point, tolerance);
      emit();
    },
    clearHover() {
      if (!target) return;
      target = undefined;
      emit();
    },
    getPreviewDocument: previewDocument,
    cancel,
    update,
    begin(
      id: string,
      point: Point,
      appearance: Appearance,
      style: ConnectorStyle,
      tolerance: number
    ) {
      const doc = host.getDocument();
      if (doc.items[id]) throw new Error('Duplicate connector id');
      target = connectorTargetAt(doc, point, tolerance);
      const port = target?.active;
      const start: ConnectorEndpoint = {
        point: port?.point ?? point,
        ...(port
          ? { binding: { targetId: port.targetId, anchor: port.anchor } }
          : {}),
      };
      gesture = {
        creating: true,
        endpoint: 'end',
        dropTarget: port,
        item: {
          id,
          type: 'connector',
          placement: {
            parentId: doc.rootId,
            sortKey: keysAt(doc, children(doc), children(doc).length, 1)[0]!,
          },
          transform: IDENTITY,
          appearance: { ...appearance, fill: 'transparent' },
          geometry: { ...style, start, end: start },
        },
      };
      emit();
    },
    edit(id: string, endpoint: 'start' | 'end') {
      const item = host.getDocument().items[id];
      if (item?.type !== 'connector') return false;
      gesture = { item, endpoint, creating: false };
      emit();
      return true;
    },
    commit(minLength = 0) {
      const current = gesture;
      if (!current) return false;
      const doc = previewDocument(),
        item = resolveConnector(doc, current.item);
      const world = worldMatrix(doc, item.id),
        start = transformPoint(world, item.geometry.start.point),
        end = transformPoint(world, item.geometry.end.point);
      cancel();
      if (
        current.creating &&
        Math.hypot(end.x - start.x, end.y - start.y) < minLength
      )
        return false;
      host.commit(item);
      return true;
    },
  };
}
