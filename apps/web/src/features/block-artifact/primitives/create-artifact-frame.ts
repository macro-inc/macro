import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  type ArtifactTheme,
  readFrameMessage,
  themeMessage,
} from '../core/frame-message';

/**
 * The host side of one artifact frame: which URL finished loading, the
 * height the page asked for, and the theme posted to it. Messages count only
 * from this frame's window at the view URL's exact origin.
 */
export function createArtifactFrame(options: {
  url: Accessor<string | undefined>;
  origin: Accessor<string | undefined>;
  theme: Accessor<ArtifactTheme>;
}) {
  const [element, setElement] = createSignal<HTMLIFrameElement>();
  const [loadedUrl, setLoadedUrl] = createSignal<string>();
  const [height, setHeight] = createSignal<number>();

  const postTheme = (theme: ArtifactTheme) => {
    const target = element()?.contentWindow;
    const origin = options.origin();
    if (!target || !origin) return;
    target.postMessage(themeMessage(theme), origin);
  };

  const onMessage = (event: MessageEvent) => {
    const origin = options.origin();
    if (!origin) return;
    const message = readFrameMessage(event, {
      origin,
      window: element()?.contentWindow,
    });
    if (message) setHeight(message.height);
  };
  window.addEventListener('message', onMessage);
  onCleanup(() => window.removeEventListener('message', onMessage));

  createEffect(on(options.theme, postTheme, { defer: true }));

  return {
    setElement,
    height,
    /** The current URL has loaded; a new URL starts loading again. */
    loaded: () => {
      const url = options.url();
      return !!url && loadedUrl() === url;
    },
    onLoad: () => {
      setLoadedUrl(options.url());
      // The theme may have changed since the URL was requested.
      postTheme(options.theme());
    },
  };
}
