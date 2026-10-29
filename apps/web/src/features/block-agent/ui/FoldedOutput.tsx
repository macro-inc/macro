/** Free-form text a tool call reported - a search hit, a fetched page, a raw fallback. */
export function FoldedOutput(props: { text: string }) {
  return (
    <pre class="overflow-x-auto font-mono text-xs whitespace-pre-wrap wrap-break-word">
      {props.text}
    </pre>
  );
}
