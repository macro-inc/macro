import { blockTextSignal } from '@core/signal/load';

export function HtmlPreview() {
  const blockText = blockTextSignal.get;

  return (
    <div class="size-full bg-panel overflow-auto">
      <iframe
        title="HTML preview"
        class="size-full border-0 bg-white"
        sandbox=""
        srcdoc={blockText() ?? ''}
      />
    </div>
  );
}
