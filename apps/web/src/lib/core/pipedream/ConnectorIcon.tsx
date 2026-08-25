import { PIPEDREAM_ICON_MAP } from '@core/component/AI/constant/mcpServers';
import { proxyImageUrl } from '@core/util/imageProxy';
import PlugIcon from '@phosphor-icons/core/regular/plug.svg?component-solid';
import { Show } from 'solid-js';

/**
 * Connector icon: our bundled SVG for the apps we ship icons for, the
 * directory-provided icon otherwise, and a generic plug as the fallback.
 * Directory icons load through the image proxy — the app's COEP blocks
 * cross-origin images from hosts that don't send CORP headers.
 */
export function PipedreamConnectorIcon(props: {
  appSlug: string;
  iconUrl?: string | null;
  /** Sizing for both the bundled SVG and the directory image. */
  class?: string;
}) {
  const BundledIcon = () => PIPEDREAM_ICON_MAP.get(props.appSlug);
  const sizeClass = () => props.class ?? 'size-5';
  return (
    <Show
      when={BundledIcon()}
      fallback={
        <Show when={props.iconUrl} fallback={<PlugIcon class={sizeClass()} />}>
          {(iconUrl) => (
            <img
              src={proxyImageUrl(iconUrl())}
              alt=""
              loading="lazy"
              class={`${sizeClass()} rounded object-contain`}
            />
          )}
        </Show>
      }
    >
      {(Icon) => {
        const C = Icon();
        return <C class={sizeClass()} />;
      }}
    </Show>
  );
}
