import type { PasteNodeDecoratorProps } from '@macro-inc/lexical-core';
import { cn, Layer } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { PasteNodeHostProp } from '../../decorator-host/paste-node-host';
import { PasteActionsMenu } from './paste/PasteActionsMenu';
import { PasteTextViewer } from './paste/PasteTextViewer';
import { ReferencedText } from './paste/ReferencedText';
import { usePasteNode } from './paste/usePasteNode';

/**
 * Source `importJSON` normalizes the origin but keeps stored content as is, so
 * a null or omitted content reaches a clipboard paste, which renders it as
 * text. A referenced chip's content must be text: its quote preview parses it
 * as markdown (`StaticMarkdown` reads `markdown.includes`).
 */
export type PasteNodeUIProps = Omit<
  PasteNodeDecoratorProps,
  'content' | 'origin'
> &
  PasteNodeHostProp &
  (
    | { origin: 'referenced'; content: string }
    | { origin?: 'pasted'; content?: string | null }
  );

/** The props of a referenced chip; undefined for a clipboard paste. */
function referencedProps(props: PasteNodeUIProps) {
  return props.origin === 'referenced' ? props : undefined;
}

/**
 * Block-level decorator for a {@link PasteNode}. A clipboard paste renders
 * as the collapsed code-fence chip below; text referenced from a
 * conversation renders as a quote reply ({@link ReferencedText}), the same
 * row a channel reply uses.
 */
export function PasteNode(props: PasteNodeUIProps) {
  return (
    <Show when={referencedProps(props)} fallback={<PastedText {...props} />}>
      {(referenced) => <ReferencedText {...referenced()} />}
    </Show>
  );
}

/**
 * A compact collapsed monospace preview that looks like a code fence and
 * fades to the background color at the bottom, with a "pasted" pill in the
 * bottom-left and a `⋯` menu floating in the top-right. Clicking it opens
 * the full text. Mirrors the DocumentCard.
 */
function PastedText(props: PasteNodeUIProps) {
  const node = usePasteNode(props);
  const [open, setOpen] = createSignal(false);

  return (
    <Layer depth={2}>
      <div
        contentEditable={false}
        class={cn(
          'relative my-2 w-full rounded border border-edge bg-surface no-select-children select-none overflow-hidden',
          node.isSelectedAsNode() && 'bg-active outline-edge outline-4'
        )}
        on:click={(e) => {
          // Native listener (not delegated `onClick`) so this fires during
          // real DOM bubbling and its stopPropagation beats the MarkdownTextarea
          // container's native `on:click`, which otherwise calls editor.focus()
          // and steals focus back, instantly closing the modal in input boxes.
          e.preventDefault();
          e.stopPropagation();
          node.selectNode();
          setOpen(true);
        }}
      >
        {/* Compact monospace preview that fades to the background. */}
        <div class="relative max-h-28 overflow-hidden">
          <pre class="font-mono text-xs leading-relaxed bg-message p-3 m-0 whitespace-pre overflow-hidden">
            {props.content}
          </pre>
          <div class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-message" />
        </div>

        <span class="absolute bottom-2 left-2 inline-flex items-center px-2 py-1 text-xs leading-none rounded-full border border-edge bg-surface">
          {node.origin()}
        </span>

        {/* Hidden in static / read-only renders (no editable editor),
            mirroring the reference cards. */}
        <Show when={node.isEditable()}>
          <PasteActionsMenu
            class="absolute top-1 right-1"
            onCopy={node.copyText}
            onConvertToText={node.convertToText}
            onDelete={node.deleteNode}
          />
        </Show>
      </div>

      <PasteTextViewer
        open={open()}
        onOpenChange={setOpen}
        title="Pasted text"
        // The viewer counts lines of text; a stored null or omitted content
        // shows as the empty text its preview renders.
        content={props.content ?? ''}
        onCopy={node.copyText}
      />
    </Layer>
  );
}
