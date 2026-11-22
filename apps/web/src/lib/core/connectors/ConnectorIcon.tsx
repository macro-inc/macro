import { proxyImageUrl } from '@core/util/imageProxy';
import PlugIcon from '@icon/system/regular/plug.svg?component-solid';
import { createSignal, Show } from 'solid-js';
import { bundledAppIcon } from './app-icons';

/**
 * Prefer the directory's current app logo, then a bundled icon, then a plug.
 * Directory images use the image proxy to satisfy the app's COEP policy.
 */
export function ConnectorIcon(props: {
  appSlug: string;
  iconUrl?: string | null;
  /** Sizing for both the bundled SVG and the directory image. */
  class?: string;
}) {
  const [failedUrl, setFailedUrl] = createSignal<string>();
  const iconUrl = () =>
    props.iconUrl !== failedUrl() ? props.iconUrl : undefined;
  const BundledIcon = () => bundledAppIcon(props.appSlug);
  const sizeClass = () => props.class ?? 'size-5';
  return (
    <Show
      keyed
      when={iconUrl()}
      fallback={
        <Show when={BundledIcon()} fallback={<PlugIcon class={sizeClass()} />}>
          {(Icon) => {
            const C = Icon();
            return <C class={sizeClass()} />;
          }}
        </Show>
      }
    >
      {(url) => (
        <img
          src={proxyImageUrl(url)}
          alt=""
          loading="lazy"
          onError={() => setFailedUrl(url)}
          class={`${sizeClass()} rounded object-contain`}
          // The directory's Notion logo is black on transparent.
          classList={{
            'invert light-mode:invert-0': props.appSlug === 'notion',
          }}
        />
      )}
    </Show>
  );
}
