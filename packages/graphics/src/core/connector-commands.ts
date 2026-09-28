import type { GraphicsCommand } from './commands';
import { resolveConnector } from './connectors';
import type { ShapeItem } from './model';
import {
  type ConnectorGeometry,
  connectorDefinition,
} from './shapes/connector';
import { selectedShapeIds } from './style-selection';

export const setConnectorCommand: GraphicsCommand<ShapeItem<'connector'>> = {
  id: 'set-connector',
  apply: ({ document }, item) => {
    const previous = document.items[item.id];
    if (previous && previous.type !== 'connector')
      throw new Error('Connector id belongs to another node');
    if (!connectorDefinition.validateGeometry(item.geometry))
      throw new Error('Invalid connector geometry');
    if (
      previous?.type === 'connector' &&
      connectorDefinition.sameGeometry(previous, item)
    )
      return { document, selection: [item.id] };
    const next = { ...document, items: { ...document.items, [item.id]: item } };
    // Remember the final visible endpoints as fallbacks without storing a route cache.
    next.items[item.id] = resolveConnector(next, item);
    return { document: next, selection: [item.id] };
  },
};
export type ConnectorStyle = Pick<
  ConnectorGeometry,
  'route' | 'startHead' | 'endHead'
>;
export const connectorStyleCommand: GraphicsCommand<Partial<ConnectorStyle>> = {
  id: 'connector-style',
  apply: ({ document, selection }, patch) => {
    const items = { ...document.items };
    let changed = false;
    for (const id of selectedShapeIds(document, selection)) {
      const item = items[id];
      if (item?.type !== 'connector') continue;
      const next = { ...item, geometry: { ...item.geometry, ...patch } };
      if (connectorDefinition.sameGeometry(item, next)) continue;
      if (!connectorDefinition.validateGeometry(next.geometry))
        throw new Error('Invalid connector style');
      items[id] = next;
      changed = true;
    }
    return { document: changed ? { ...document, items } : document };
  },
};
