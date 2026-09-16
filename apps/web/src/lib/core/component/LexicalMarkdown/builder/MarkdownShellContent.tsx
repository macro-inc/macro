import { Show } from 'solid-js';

/** Fixed editor markup; Lexical owns the editable element's contents. */
export function MarkdownShellContent(props: {
  connectRoot: (element: HTMLDivElement) => void;
  disabled: boolean;
  showPlaceholder: boolean;
  placeholder: string;
}) {
  return (
    <>
      <div
        data-markdown-editable
        ref={props.connectRoot}
        contentEditable={!props.disabled}
      />
      <Show when={props.showPlaceholder}>
        <div
          data-markdown-placeholder
          class="pointer-events-none text-ink-placeholder absolute top-0"
        >
          <p class="my-1.5 pointer-events-none">{props.placeholder}</p>
        </div>
      </Show>
    </>
  );
}
