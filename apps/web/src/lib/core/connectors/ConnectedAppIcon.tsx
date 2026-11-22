import { useConnectorCatalogIconsQuery } from '@queries/connectors';
import { queryReadyGate } from '@queries/gate';
import { ConnectorIcon } from './ConnectorIcon';

/**
 * Icon for a connected app, whose record knows its slug and not its logo.
 */
export function ConnectedAppIcon(props: { appSlug: string; class?: string }) {
  const icons = useConnectorCatalogIconsQuery();
  const iconUrl = () =>
    queryReadyGate(icons) ? icons.data.get(props.appSlug) : undefined;
  return (
    <ConnectorIcon
      appSlug={props.appSlug}
      iconUrl={iconUrl()}
      class={props.class}
    />
  );
}
