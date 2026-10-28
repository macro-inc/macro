export function HtmlPreview(props: { text: string }) {
  return (
    // Static pads on mobile/tablet: the iframe scrolls internally, so its content
    // can't under-scroll the floating chrome — the viewport sits between it.
    <div class="size-full bg-surface overflow-auto touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
      <iframe
        title="HTML preview"
        class="size-full border-0"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcdoc={props.text}
      />
    </div>
  );
}
