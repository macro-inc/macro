import type { PasteNodeDecoratorProps } from '@macro-inc/lexical-core';
import { cn, Layer } from '@ui';
import { createSignal, Show } from 'solid-js';
import { QuoteReplyPreview } from '../QuoteReplyPreview';
import { PasteActionsMenu } from './PasteActionsMenu';
import { PasteTextViewer } from './PasteTextViewer';
import { usePasteNode } from './usePasteNode';

/**
 * A {@link PasteNode} whose origin is `referenced`: transcript text the user
 * chose to reply to. It is the channel quote reply's row
 * ({@link QuoteReplyPreview}), so a reference reads the same everywhere —
 * one clipped line, the full text behind a click.
 */
export function ReferencedText(props: PasteNodeDecoratorProps) {
  const node = usePasteNode(props);
  const [open, setOpen] = createSignal(false);

  return (
    <Layer depth={2}>
      <div
        contentEditable={false}
        class={cn(
          'my-1 rounded-md no-select-children select-none',
          node.isSelectedAsNode() && 'bg-active outline-edge outline-4'
        )}
      >
        <QuoteReplyPreview
          label="Replying to"
          text={props.content}
          ariaLabel={`Replying to: ${props.content}`}
          onClick={(event) => {
            // Native listener so stopPropagation beats the container's
            // `on:click`, which would otherwise refocus the editor and close
            // the viewer as soon as it opens (see the paste chip).
            event.preventDefault();
            event.stopPropagation();
            node.selectNode();
            setOpen(true);
          }}
          buttonAttrs={{ 'data-referenced-text': '' }}
          trailing={
            <Show when={node.isEditable()}>
              <PasteActionsMenu
                class="shrink-0 opacity-0 transition-opacity group-hover/reply-target:opacity-100 focus-within:opacity-100"
                onCopy={node.copyText}
                onConvertToText={node.convertToText}
                onDelete={node.deleteNode}
              />
            </Show>
          }
        />
      </div>
      <PasteTextViewer
        open={open()}
        onOpenChange={setOpen}
        title="Referenced text"
        content={props.content}
        onCopy={node.copyText}
      />
    </Layer>
  );
}
