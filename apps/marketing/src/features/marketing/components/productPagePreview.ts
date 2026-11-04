import { isServer } from 'solid-js/web';

/** Only the product pages embedded by the homepage use in-panel navigation. */
export function isEmbeddedProductPage() {
  return (
    !isServer &&
    window.self !== window.top &&
    new URLSearchParams(window.location.search).get('embed') === 'feature'
  );
}
