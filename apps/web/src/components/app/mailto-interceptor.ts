import { globalSplitManager } from '@app/signal/splitLayout';
import { parseMailto } from '@block-email/util/mailto';
import { getOwner, onCleanup, onMount } from 'solid-js';

/**
 * Opens mailto: links in the in-app email composer instead of the OS mail
 * client. Capture-phase listener so links inside email-body shadow roots and
 * editors are caught; composedPath crosses the shadow boundaries.
 */
export function mountMailtoInterceptor() {
  const owner = getOwner();
  if (!owner) {
    console.error(
      'No owner. mountMailtoInterceptor should be called once - from within the component tree.'
    );
    return;
  }
  onMount(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = e
        .composedPath()
        .find(
          (el): el is HTMLAnchorElement =>
            el instanceof HTMLAnchorElement && el.href.startsWith('mailto:')
        );
      // Links inside editors: let the click place the cursor instead.
      if (!anchor || anchor.isContentEditable) return;
      const parsed = parseMailto(anchor.href);
      if (!parsed) return;
      // Not ready yet — let the OS mail client handle it.
      const manager = globalSplitManager();
      if (!manager) return;
      e.preventDefault();
      manager.openWithSplit({
        type: 'component',
        id: 'email-compose',
        params: parsed.to.length ? { initialTo: parsed.to } : undefined,
        preserveParams: true,
      });
    };
    document.addEventListener('click', onClick, { capture: true });
    onCleanup(() =>
      document.removeEventListener('click', onClick, { capture: true })
    );
  });
}
