import { MobileDrawer } from '@app/component/mobile/MobileDrawer';
import { toast } from '@core/component/Toast/Toast';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { blockElementSignal } from '@core/signal/blockElement';
import {
  $convertPasteToText,
  $isPasteNode,
  type PasteNodeDecoratorProps,
} from '@lexical-core';
import Copy from '@phosphor/copy.svg';
import DotsThree from '@phosphor/list.svg';
import TextT from '@phosphor/text-t.svg';
import TrashSimple from '@phosphor/trash-simple.svg';
import { Button, cn, Dialog, Dropdown, Layer } from '@ui';
import { $createNodeSelection, $getNodeByKey, $setSelection } from 'lexical';
import { createSignal, Show, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { removeNodeAndRestoreSelection } from '../../plugins/shared/removeNodeAndRestoreSelection';

/**
 * Block-level decorator for a {@link PasteNode}. Renders a compact collapsed
 * monospace preview that looks like a code fence and fades to the background
 * color at the bottom, with a "pasted" pill in the bottom-left and a hamburger
 * menu floating in the top-right (Convert to text / Delete). Clicking the node
 * opens the full text styled like a code fence: a scrollable popup on desktop
 * and a bottom drawer on mobile, both dismissable with `esc` or by clicking
 * outside. Mirrors the DocumentCard.
 */
export function PasteNode(props: PasteNodeDecoratorProps) {
  const wrapper = useContext(LexicalWrapperContext);
  const editor = () => wrapper?.editor;
  const selection = () => wrapper?.selection;

  const [open, setOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const selectNode = () => {
    const e = editor();
    if (!e) return;
    if (!e.isEditable()) return;
    e.update(() => {
      const sel = $createNodeSelection();
      sel.add(props.key);
      $setSelection(sel);
    });
  };

  const convertToText = () => {
    editor()?.update(() => {
      const node = $getNodeByKey(props.key);
      if (!$isPasteNode(node)) return false;
      $convertPasteToText(node);
      return true;
    });
  };

  const copyText = () => {
    try {
      navigator.clipboard.writeText(props.content);
      toast.success('Copied pasted text to clipboard');
    } catch (e) {
      console.error('Failed to copy pasted text to clipboard', e);
    }
  };

  const deletePaste = () => {
    const currentEditor = editor();
    if (!currentEditor) return;
    removeNodeAndRestoreSelection(currentEditor, props.key, $isPasteNode);
  };

  const lineCount = () => props.content.split('\n').length;
  const lineLabel = () =>
    `${lineCount()} ${lineCount() === 1 ? 'line' : 'lines'}`;

  const fullText = () => (
    <pre class="font-mono text-sm leading-relaxed bg-message p-4 m-0 whitespace-pre-wrap wrap-break-word overflow-auto">
      {props.content}
    </pre>
  );

  return (
    <Layer depth={2}>
      <div
        contentEditable={false}
        class={cn(
          'relative my-2 w-full rounded border border-edge bg-surface no-select-children select-none overflow-hidden cursor-pointer',
          isSelectedAsNode() && 'bg-active outline-edge outline-4'
        )}
        on:click={(e) => {
          // Native listener (not delegated `onClick`) so this fires during
          // real DOM bubbling and its stopPropagation beats the MarkdownTextarea
          // container's native `on:click`, which otherwise calls editor.focus()
          // and steals focus back, instantly closing the modal in input boxes.
          e.preventDefault();
          e.stopPropagation();
          selectNode();
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

        {/* "pasted" pill floating bottom-left. */}
        <span class="absolute bottom-2 left-2 inline-flex items-center px-2 py-1 text-xs leading-none rounded-full border border-edge bg-surface">
          pasted
        </span>

        {/* Hamburger menu floating top-right. Hidden in static / read-only
            renders (no editable editor), mirroring the reference cards. */}
        <Show when={editor()?.isEditable()}>
          <div
            class="absolute top-1 right-1"
            on:click={(e) => e.stopPropagation()}
          >
            <Dropdown open={menuOpen()} onOpenChange={setMenuOpen}>
              <Dropdown.Trigger size="icon-sm" variant="ghost">
                <DotsThree />
              </Dropdown.Trigger>
              <Dropdown.Content mount={blockElementSignal.get()}>
                <Dropdown.Group>
                  <Dropdown.Item onSelect={copyText}>
                    <Copy class="size-4 shrink-0" />
                    <span class="flex-1 truncate">Copy</span>
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={convertToText}>
                    <TextT class="size-4 shrink-0" />
                    <span class="flex-1 truncate">Convert to text</span>
                  </Dropdown.Item>
                </Dropdown.Group>
                <Dropdown.Group>
                  <Dropdown.Item onSelect={deletePaste}>
                    <TrashSimple class="size-4 shrink-0" />
                    <span class="flex-1 truncate">Delete</span>
                  </Dropdown.Item>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </div>
        </Show>
      </div>

      {/* Full-text view, styled like a code fence. Drawer on mobile, dialog on
          desktop; both scroll correctly and close on esc / outside click. */}
      <Show
        when={isMobileWidth()}
        fallback={
          <Dialog
            open={open()}
            onOpenChange={setOpen}
            position="center"
            class="rounded-lg border border-edge bg-surface shadow-lg"
          >
            <div class="flex items-center justify-between px-4 py-2 border-b border-edge text-xs text-ink-muted">
              <span>Pasted text</span>
              <div class="flex items-center gap-2">
                <span>{lineLabel()}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="text-ink-extra-muted/50"
                  tooltip="Copy"
                  on:click={() => copyText()}
                >
                  <Copy />
                </Button>
              </div>
            </div>
            <div class="max-h-[70vh] overflow-auto">{fullText()}</div>
          </Dialog>
        }
      >
        <MobileDrawer side="bottom" open={open()} onOpenChange={setOpen}>
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
            <MobileDrawer.Content aria-label="Pasted text">
              <MobileDrawer.Handle />
              <div class="flex items-center justify-between px-4 pb-2 text-xs text-ink-muted shrink-0">
                <span>Pasted text</span>
                <div class="flex items-center gap-2">
                  <span>{lineLabel()}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-ink-extra-muted/50"
                    tooltip="Copy"
                    on:click={() => copyText()}
                  >
                    <Copy />
                  </Button>
                </div>
              </div>
              <div class="flex-1 min-h-0 overflow-auto">{fullText()}</div>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </Layer>
  );
}
