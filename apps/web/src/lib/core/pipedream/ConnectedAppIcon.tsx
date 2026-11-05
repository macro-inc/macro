import { queryReadyGate } from '@queries/gate';
import { usePipedreamCatalogIconsQuery } from '@queries/pipedream-connectors';
import { PipedreamConnectorIcon } from './ConnectorIcon';

/**
 * Icon for a connected app, whose record knows its slug and not its logo.
 */
export function ConnectedAppIcon(props: { appSlug: string; class?: string }) {
  const icons = usePipedreamCatalogIconsQuery();
  const iconUrl = () =>
    queryReadyGate(icons) ? icons.data.get(props.appSlug) : undefined;
  return (
    <PipedreamConnectorIcon
      appSlug={props.appSlug}
      iconUrl={iconUrl()}
      class={props.class}
    />
  );
}
