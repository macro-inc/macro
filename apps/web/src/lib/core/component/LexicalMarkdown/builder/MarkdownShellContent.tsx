import { Show } from 'solid-js';

/** Fixed editor markup; Lexical owns the editable element's contents. */
export function MarkdownShellContent(props: {
  connectRoot: (element: HTMLDivElement) => void;
  disabled: boolean;
  showPlaceholder: boolean;
  placeholder: string | undefined;
}) {
  return (
    <>
      <div
        data-markdown-editable
        ref={props.connectRoot}
        contentEditable={!props.disabled}
        role="textbox"
        aria-multiline="true"
        aria-readonly={props.disabled}
        aria-label={props.placeholder || 'Message'}
      />
      <Show when={props.showPlaceholder}>
        <div
          data-markdown-placeholder
          class="pointer-events-none text-ink-placeholder absolute top-0"
        >
          <p class="my-1.5 pointer-events-none">{props.placeholder ?? '...'}</p>
        </div>
      </Show>
    </>
  );
}
