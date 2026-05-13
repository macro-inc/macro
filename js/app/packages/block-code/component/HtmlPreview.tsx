import { blockTextSignal } from '@core/signal/load';
import { createEffect, createMemo } from 'solid-js';

export function HtmlPreview() {
  const blockText = createMemo(blockTextSignal.get);
  createEffect(() => {
    console.log(blockText());
  });

  return (
    <div class="size-full bg-surface overflow-auto">
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
