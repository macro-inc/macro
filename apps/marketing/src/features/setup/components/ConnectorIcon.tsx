import PlugIcon from '@phosphor/plug.svg';
import { Show } from 'solid-js';
import { FEATURED_MCP_SERVERS } from '../core/featuredIntegrations';

/** Brand marks are website-owned assets, independent of the app catalog. */
export function ConnectorIcon(props: { appSlug: string; class?: string }) {
  const icon = () =>
    FEATURED_MCP_SERVERS.find((entry) => entry.app_slug === props.appSlug)
      ?.icon;
  return (
    <Show when={icon()} fallback={<PlugIcon class={props.class ?? 'size-5'} />}>
      {(Icon) => {
        const Component = Icon();
        return <Component class={props.class ?? 'size-5'} />;
      }}
    </Show>
  );
}
