import { usePipedreamCatalogIconsQuery } from '@queries/pipedream-connectors';
import { PipedreamConnectorIcon } from './ConnectorIcon';

/**
 * Icon for a connected app, whose record knows its slug and not its logo.
 */
export function ConnectedAppIcon(props: { appSlug: string; class?: string }) {
  const icons = usePipedreamCatalogIconsQuery();
  return (
    <PipedreamConnectorIcon
      appSlug={props.appSlug}
      iconUrl={icons.data?.get(props.appSlug)}
      class={props.class}
    />
  );
}
