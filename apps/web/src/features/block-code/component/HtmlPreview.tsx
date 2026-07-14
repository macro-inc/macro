import { blockTextSignal } from '@core/signal/load';
import { createEffect, createMemo } from 'solid-js';

export function HtmlPreview() {
  const blockText = createMemo(blockTextSignal.get);
  createEffect(() => {
    console.log(blockText());
  });

  return (
    // Static pads on mobile: the iframe scrolls internally, so its content
    // can't under-scroll the floating chrome — the viewport sits between it.
    <div class="size-full bg-surface overflow-auto mobile:pt-(--mobile-content-inset-top) mobile:pb-(--mobile-content-inset-bottom)">
      <iframe
        title="HTML preview"
        class="size-full border-0"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcdoc={blockText() ?? ''}
      />
    </div>
  );
}
